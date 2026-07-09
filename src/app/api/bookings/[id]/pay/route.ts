/**
 * POST /api/bookings/[id]/pay
 *
 * Wallet payment for an APPROVED_UNPAID REQUEST-mode space booking
 * (Airbnb-style approve-then-pay). The money-critical core runs entirely
 * inside ONE db.update critical section:
 *
 *   1. Validate token hash + ownership + status + link expiry.
 *   2. Idempotency: paidAt already set → return the confirmed result, no-op.
 *      A completed charge transaction with this booking's reference likewise
 *      short-circuits the debit (crash-recovery replay).
 *   3. Debit the user wallet (insufficient → { needsTopUp } with NO state change).
 *   4. Set paidAt, transition APPROVED_UNPAID → CONFIRMED, credit the
 *      incubator wallet (same full-amount PAYOUT accounting as the legacy
 *      approve path, reference `payout-${bookingId}`).
 *
 * Emails / in-app notifications fire after the critical section and are
 * non-blocking — a notification failure can never roll back the payment.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiSession } from '@/server/auth/api-guards';
import { db, type TransactionRecord, type WalletRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { hashPaymentLinkToken } from '@/server/bookings/request-mode';
import { toBookingDto } from '@/server/bookings/serialize';
import { findIncubatorById } from '@/server/incubator/service';
import { createNotification } from '@/server/notifications/create-notification';
import {
  sendBookingConfirmedWithQrEmail,
  sendBookingPaidIncubatorEmail,
} from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(16).max(200) });

function newWallet(userId: string): WalletRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    balance: 0,
    currency: 'DZD',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiSession();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  // 20 attempts/hour is plenty for honest retries while throttling token probing.
  if (!(await checkRateLimitDistributed(`booking-pay:${guard.user.id}:${id}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const tokenHash = hashPaymentLinkToken(input.token);

  const result = await db.update((d) => {
    const booking = d.bookings.find((b) => b.id === id);
    if (!booking) return { err: 'NOT_FOUND' } as const;
    if (booking.userId !== guard.user.id) return { err: 'FORBIDDEN' } as const;
    if (booking.reservationMode !== 'REQUEST') return { err: 'NOT_PAYABLE' } as const;

    const customer = d.users.find((u) => u.id === guard.user.id);
    const customerInfo = {
      customerName:   customer?.fullName ?? 'Unknown',
      customerEmail:  customer?.email ?? '',
      customerLocale: customer?.locale ?? 'fr',
    };

    // ── Idempotency: already settled → return the confirmed result, no-op.
    if (booking.paidAt) {
      return { ok: true, replayed: true, booking, incubatorId: null, ...customerInfo } as const;
    }

    if (booking.status === 'CANCELLED') return { err: 'BOOKING_CANCELLED' } as const;
    if (booking.status !== 'APPROVED_UNPAID') return { err: 'NOT_PAYABLE' } as const;
    if (!booking.paymentLinkTokenHash || booking.paymentLinkTokenHash !== tokenHash) {
      return { err: 'INVALID_TOKEN' } as const;
    }
    if (booking.paymentLinkExpiresAt && Date.parse(booking.paymentLinkExpiresAt) < Date.now()) {
      return { err: 'LINK_EXPIRED' } as const;
    }

    // ── Debit the user wallet (inline so the debit, the transition and the
    // incubator credit live in one critical section and can never disagree).
    let wallet = d.wallets.find((w) => w.userId === guard.user.id);
    if (!wallet) {
      wallet = newWallet(guard.user.id);
      d.wallets.push(wallet);
    }
    if (wallet.status === 'FROZEN') return { err: 'WALLET_FROZEN' } as const;

    const total = booking.totalAmount;
    const chargeRef = `booking-pay-${booking.id}`;
    // Reference-level idempotency (chargeWallet pattern): a prior non-failed
    // charge means a crashed request already moved the user's money — finish
    // the transition without charging again.
    const existingCharge = d.transactions.find(
      (t) => t.walletId === wallet!.id && t.reference === chargeRef && t.status !== 'FAILED',
    );

    if (!existingCharge && total > 0 && wallet.balance < total) {
      return { err: 'INSUFFICIENT_FUNDS', balance: wallet.balance, required: total } as const;
    }

    const now = new Date().toISOString();
    let tx: TransactionRecord | null = existingCharge ?? null;
    if (!tx && total > 0) {
      wallet.balance -= total;
      wallet.updatedAt = now;
      tx = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: guard.user.id,
        type: 'PAYMENT',
        amount: -total,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Booking — ${booking.itemName}`,
        reference: chargeRef,
        provider: 'internal',
        providerTxnId: null,
        metadata: { bookingId: booking.id, bookingItemKind: 'SPACE', bookingItemId: booking.itemId, reservationMode: 'REQUEST' },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);
    }

    // ── Transition: APPROVED_UNPAID → CONFIRMED (paidAt = idempotency stamp).
    booking.paidAt = now;
    booking.status = 'CONFIRMED';
    booking.transactionId = tx?.id ?? booking.transactionId ?? null;
    booking.updatedAt = now;

    // ── Credit the incubator wallet — same accounting as the legacy approve
    // path (full amount, PAYOUT tx, reference `payout-${bookingId}`).
    const spaceRec = (d.spaces ?? []).find((s) => s.id === booking.itemId);
    const incubator = spaceRec ? d.incubators.find((i) => i.id === spaceRec.incubatorId) : undefined;
    if (incubator?.managerId && total > 0) {
      const payoutRef = `payout-${booking.id}`;
      const existingPayout = d.transactions.find(
        (t) => t.reference === payoutRef && t.status !== 'FAILED',
      );
      if (!existingPayout) {
        let incubatorWallet = d.wallets.find((w) => w.userId === incubator.managerId);
        if (!incubatorWallet) {
          incubatorWallet = newWallet(incubator.managerId);
          d.wallets.push(incubatorWallet);
        }
        if (incubatorWallet.status !== 'FROZEN') {
          incubatorWallet.balance += total;
          incubatorWallet.updatedAt = now;
          d.transactions.push({
            id: randomUUID(),
            walletId: incubatorWallet.id,
            userId: incubator.managerId,
            type: 'PAYOUT',
            amount: total,
            balanceAfter: incubatorWallet.balance,
            status: 'COMPLETED',
            description: `Booking revenue — ${booking.itemName}`,
            reference: payoutRef,
            provider: 'internal',
            providerTxnId: null,
            metadata: { bookingId: booking.id, customerId: booking.userId, reservationMode: 'REQUEST' },
            createdAt: now,
            completedAt: now,
          });
        }
      }
    }

    return { ok: true, replayed: false, booking, incubatorId: incubator?.id ?? null, ...customerInfo } as const;
  });

  if ('err' in result) {
    switch (result.err) {
      case 'NOT_FOUND':          return jsonError(404, 'NOT_FOUND', 'Booking not found');
      case 'FORBIDDEN':          return jsonError(403, 'FORBIDDEN', 'This booking belongs to another account');
      case 'NOT_PAYABLE':        return jsonError(409, 'NOT_PAYABLE', 'This booking is not awaiting payment');
      case 'BOOKING_CANCELLED':  return jsonError(410, 'BOOKING_CANCELLED', 'This booking was cancelled');
      case 'INVALID_TOKEN':      return jsonError(403, 'INVALID_TOKEN', 'Invalid payment link');
      case 'LINK_EXPIRED':       return jsonError(410, 'LINK_EXPIRED', 'This payment link has expired');
      case 'WALLET_FROZEN':      return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
      case 'INSUFFICIENT_FUNDS':
        return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
          needsTopUp: true,
          balance: result.balance,
          required: result.required,
        });
    }
  }

  // ── Non-blocking notifications (never roll back the payment). AWAITED —
  // not void-fired — because a serverless lambda can freeze right after the
  // response and drop fired-and-forgotten work; the inner try/catch still
  // guarantees a notification failure never breaks the payment response.
  if (!result.replayed) {
    const { booking, customerName, customerEmail, incubatorId } = result;
    await (async () => {
      try {
        if (customerEmail) {
          sendBookingConfirmedWithQrEmail(customerEmail, {
            customerName,
            bookingId:   booking.id,
            itemName:    booking.itemName,
            itemKind:    booking.itemKind,
            vendorName:  booking.vendorName,
            city:        booking.city,
            startsAt:    booking.startsAt,
            endsAt:      booking.endsAt,
            totalAmount: booking.totalAmount,
            createdAt:   booking.createdAt,
          });
        }
        if (booking.userId) {
          await createNotification({
            userId: booking.userId,
            type: 'BOOKING_CONFIRMED',
            title: 'Booking confirmed',
            body: `Your booking for "${booking.itemName}" is paid and confirmed.`,
            href: '/dashboard/entrepreneur/bookings',
          });
        }
        if (incubatorId) {
          const incubator = await findIncubatorById(incubatorId);
          if (incubator) {
            sendBookingPaidIncubatorEmail(incubator, {
              customerName,
              details: {
                bookingId:   booking.id,
                itemName:    booking.itemName,
                vendorName:  booking.vendorName,
                startsAt:    booking.startsAt,
                endsAt:      booking.endsAt,
                totalAmount: booking.totalAmount,
              },
              lang: 'fr',
            });
            if (incubator.managerId) {
              await createNotification({
                userId: incubator.managerId,
                type: 'GENERAL',
                title: 'Booking paid & confirmed',
                body: `${customerName} paid for "${booking.itemName}". Your wallet has been credited.`,
                href: '/dashboard/incubator/bookings',
              });
            }
          }
        }
      } catch { /* notifications must never break the payment response */ }
    })();
  }

  return json({
    booking: toBookingDto(result.booking),
    replayed: result.replayed,
    alreadyPaid: result.replayed,
  });
}
