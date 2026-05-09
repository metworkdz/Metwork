/**
 * PATCH /api/incubator/bookings/[id]
 *
 * Incubator can CONFIRM (PENDING → CONFIRMED) or CANCEL a booking on their items.
 *
 * Wallet flows:
 *   CONFIRM → credit the incubator wallet with booking.totalAmount (PAYOUT tx).
 *   CANCEL  → refund the user wallet with booking.totalAmount (REFUND tx) if the
 *             booking was PENDING (funds still escrowed). If already CONFIRMED
 *             the incubator has been credited, so we debit them back and credit the user.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type TransactionRecord, type WalletRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { createNotification } from '@/server/notifications/create-notification';
import {
  sendBookingConfirmedWithQrEmail,
  sendBookingDeclinedEmail,
} from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['CONFIRMED', 'CANCELLED']),
  declineReason: z.string().max(500).optional(),
});

function ensureWallet(d: Parameters<Parameters<typeof db.update>[0]>[0], userId: string): WalletRecord {
  let wallet = d.wallets.find((w) => w.userId === userId);
  if (!wallet) {
    const now = new Date().toISOString();
    wallet = {
      id: randomUUID(),
      userId,
      balance: 0,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    d.wallets.push(wallet);
  }
  return wallet;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const incubator = d.incubators.find((i) => i.managerId === guard.user.id);
    if (!incubator) return 'NO_INCUBATOR';

    const ownedSpaceIds = new Set(
      d.incubatorSpaces.filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      d.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );

    const booking = d.bookings.find((b) => b.id === id);
    if (!booking) return 'NOT_FOUND';

    const isOwned =
      (booking.itemKind === 'SPACE' && ownedSpaceIds.has(booking.itemId)) ||
      (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId));

    if (!isOwned) return 'FORBIDDEN';
    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') return 'ALREADY_FINAL';
    // Can't confirm a booking that's already confirmed (idempotent CONFIRM is ok though)
    if (booking.status === 'CONFIRMED' && input.status === 'CONFIRMED') {
      const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
      return { ...booking, customerName: user?.fullName ?? booking.clientName ?? 'Unknown', customerEmail: user?.email ?? booking.clientEmail ?? '', customerPhone: user?.phone ?? booking.clientPhone ?? '' };
    }

    const now = new Date().toISOString();
    const previousStatus = booking.status;
    booking.status = input.status;
    booking.updatedAt = now;
    if (input.status === 'CANCELLED' && input.declineReason) {
      booking.declineReason = input.declineReason;
    }

    // ── Wallet movements (skip for manual/offline bookings) ──────────────────
    const isManual = booking.paymentMethod === 'manual';

    if (!isManual && input.status === 'CONFIRMED' && booking.totalAmount > 0) {
      // Credit incubator wallet (escrow → incubator)
      const incubatorWallet = ensureWallet(d, incubator.managerId!);
      if (incubatorWallet.status !== 'FROZEN') {
        incubatorWallet.balance += booking.totalAmount;
        incubatorWallet.updatedAt = now;
        const payoutTx: TransactionRecord = {
          id: randomUUID(),
          walletId: incubatorWallet.id,
          userId: incubator.managerId!,
          type: 'PAYOUT',
          amount: booking.totalAmount,
          balanceAfter: incubatorWallet.balance,
          status: 'COMPLETED',
          description: `Booking revenue — ${booking.itemName}`,
          reference: `payout-${booking.id}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: { bookingId: booking.id, customerId: booking.userId },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(payoutTx);
      }
    } else if (!isManual && booking.userId && input.status === 'CANCELLED' && booking.totalAmount > 0) {
      // Refund user wallet
      const userWallet = ensureWallet(d, booking.userId);
      if (userWallet.status !== 'FROZEN') {
        userWallet.balance += booking.totalAmount;
        userWallet.updatedAt = now;
        const refundTx: TransactionRecord = {
          id: randomUUID(),
          walletId: userWallet.id,
          userId: booking.userId,
          type: 'REFUND',
          amount: booking.totalAmount,
          balanceAfter: userWallet.balance,
          status: 'COMPLETED',
          description: `Refund — ${booking.itemName} (${input.declineReason ? 'declined' : 'cancelled'})`,
          reference: `refund-${booking.id}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: { bookingId: booking.id, declineReason: input.declineReason ?? null },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(refundTx);

        // If the incubator had already been credited (i.e., was CONFIRMED before),
        // claw it back from their wallet.
        if (previousStatus === 'CONFIRMED') {
          const incubatorWallet = ensureWallet(d, incubator.managerId!);
          incubatorWallet.balance = Math.max(0, incubatorWallet.balance - booking.totalAmount);
          incubatorWallet.updatedAt = now;
          const clawbackTx: TransactionRecord = {
            id: randomUUID(),
            walletId: incubatorWallet.id,
            userId: incubator.managerId!,
            type: 'ADJUSTMENT',
            amount: -booking.totalAmount,
            balanceAfter: incubatorWallet.balance,
            status: 'COMPLETED',
            description: `Booking reversed — ${booking.itemName}`,
            reference: `clawback-${booking.id}`,
            provider: 'internal',
            providerTxnId: null,
            metadata: { bookingId: booking.id },
            createdAt: now,
            completedAt: now,
          };
          d.transactions.push(clawbackTx);
        }
      }
    }

    const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
    return {
      ...booking,
      customerName: user?.fullName ?? booking.clientName ?? 'Unknown',
      customerEmail: user?.email ?? booking.clientEmail ?? '',
      customerPhone: user?.phone ?? booking.clientPhone ?? '',
    };
  });

  if (result === 'NO_INCUBATOR') return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile');
  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Booking not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your booking');
  if (result === 'ALREADY_FINAL') return jsonError(409, 'ALREADY_FINAL', 'Booking is already in a final state');

  // Fire-and-forget: send notification emails + in-app (skip for offline bookings with no platform user)
  void (async () => {
    if (input.status === 'CONFIRMED') {
      if (result.customerEmail) {
        sendBookingConfirmedWithQrEmail(result.customerEmail, {
          customerName: result.customerName,
          bookingId: result.id,
          itemName: result.itemName,
          itemKind: result.itemKind,
          vendorName: result.vendorName,
          city: result.city,
          startsAt: result.startsAt,
          endsAt: result.endsAt,
          totalAmount: result.totalAmount,
          createdAt: result.createdAt,
        });
      }
      if (result.userId) {
        await createNotification({
          userId: result.userId,
          type: 'BOOKING_CONFIRMED',
          title: 'Booking confirmed',
          body: `Your booking for "${result.itemName}" has been confirmed.`,
          href: '/dashboard/entrepreneur/bookings',
        });
      }
    } else if (input.status === 'CANCELLED') {
      if (result.customerEmail) {
        sendBookingDeclinedEmail(result.customerEmail, {
          customerName: result.customerName,
          bookingId: result.id,
          itemName: result.itemName,
          itemKind: result.itemKind,
          vendorName: result.vendorName,
          totalAmount: result.totalAmount,
          declineReason: input.declineReason,
        });
      }
      if (result.userId) {
        await createNotification({
          userId: result.userId,
          type: 'BOOKING_CANCELLED',
          title: 'Booking declined',
          body: `Your booking for "${result.itemName}" was declined. Your payment has been refunded.`,
          href: '/dashboard/entrepreneur/bookings',
        });
      }
    }
  })();

  return json({ booking: result });
}
