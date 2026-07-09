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
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type BookingRecord, type TransactionRecord, type WalletRecord } from '@/server/db/store';
import { checkSpaceAvailability } from '@/server/bookings/availability';
import { fromZod, json, jsonError } from '@/server/http/json';
import { createNotification } from '@/server/notifications/create-notification';
import {
  sendBookingConfirmedWithQrEmail,
  sendBookingDeclinedEmail,
  sendBookingUpdatedEmail,
  sendBookingProviderCancelledEmail,
  sendBookingApprovedPayEmail,
  sendBookingCancelledUnpaidEmail,
} from '@/server/notifications/mock';
import {
  PAYMENT_LINK_TTL_HOURS,
  newPaymentLinkToken,
  hashPaymentLinkToken,
} from '@/server/bookings/request-mode';

type StoreData = Parameters<Parameters<typeof db.update>[0]>[0];

/** True when `booking`'s item (space/program/event) belongs to this incubator. */
function bookingOwnedByIncubator(d: StoreData, incubatorId: string, booking: BookingRecord): boolean {
  const ownedSpaceIds   = new Set((d.spaces   ?? []).filter((s) => s.incubatorId === incubatorId).map((s) => s.id));
  const ownedProgramIds = new Set((d.programs ?? []).filter((p) => p.incubatorId === incubatorId).map((p) => p.id));
  const ownedEventIds   = new Set((d.events   ?? []).filter((e) => e.incubatorId === incubatorId).map((e) => e.id));
  return (
    (booking.itemKind === 'SPACE'   && ownedSpaceIds.has(booking.itemId))   ||
    (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId)) ||
    (booking.itemKind === 'EVENT'   && ownedEventIds.has(booking.itemId))
  );
}

/** A manual/offline booking carries no wallet/ledger entries — safe to edit/delete. */
function isManualBooking(b: BookingRecord): boolean {
  return b.source === 'offline' || b.paymentMethod === 'manual';
}

function computeQuantity(unit: 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH', startsAt: string, endsAt: string): number {
  const diffMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  switch (unit) {
    case 'HOUR':     return Math.max(1, Math.ceil(diffMs / 3_600_000));
    case 'HALF_DAY': return 1;
    case 'DAY':      return Math.max(1, Math.ceil(diffMs / 86_400_000));
    case 'MONTH': {
      const s = new Date(startsAt);
      const e = new Date(endsAt);
      return Math.max(1, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()));
    }
  }
}

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
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
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
      (d.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      (d.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );
    // FIX: BUG-3 — events were missing from ownership check
    const ownedEventIds = new Set(
      (d.events ?? []).filter((e) => e.incubatorId === incubator.id).map((e) => e.id),
    );

    const booking = d.bookings.find((b) => b.id === id);
    if (!booking) return 'NOT_FOUND';

    const isOwned =
      (booking.itemKind === 'SPACE'   && ownedSpaceIds.has(booking.itemId))   ||
      (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId)) ||
      (booking.itemKind === 'EVENT'   && ownedEventIds.has(booking.itemId));   // FIX: BUG-3

    if (!isOwned) return 'FORBIDDEN';
    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') return 'ALREADY_FINAL';
    // Can't confirm a booking that's already confirmed (idempotent CONFIRM is ok though)
    if (booking.status === 'CONFIRMED' && input.status === 'CONFIRMED') {
      const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
      return { ...booking, customerName: user?.fullName ?? booking.clientName ?? 'Unknown', customerEmail: user?.email ?? booking.clientEmail ?? '', customerPhone: user?.phone ?? booking.clientPhone ?? '', customerLocale: user?.locale ?? 'fr', requestApproval: null };
    }

    // ── REQUEST-mode approve: AWAITING_APPROVAL → APPROVED_UNPAID ───────────
    // No money moves here. A payment-link token is minted (hash stored, raw
    // token returned so the caller can email it), and the incubator is only
    // credited later when the client pays via POST /api/bookings/[id]/pay.
    if (booking.reservationMode === 'REQUEST' && input.status === 'CONFIRMED' && !booking.paidAt) {
      const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
      const base = {
        customerName:   user?.fullName ?? booking.clientName ?? 'Unknown',
        customerEmail:  user?.email ?? booking.clientEmail ?? '',
        customerPhone:  user?.phone ?? booking.clientPhone ?? '',
        customerLocale: user?.locale ?? 'fr',
      };
      // Idempotent re-approve: keep the original link + expiry, send nothing new.
      if (booking.status === 'APPROVED_UNPAID') {
        return { ...booking, ...base, requestApproval: null };
      }
      if (booking.status !== 'AWAITING_APPROVAL') return 'ALREADY_FINAL';
      const now = new Date().toISOString();
      const rawToken = newPaymentLinkToken();
      booking.status = 'APPROVED_UNPAID';
      booking.approvedAt = now;
      booking.paymentLinkTokenHash = hashPaymentLinkToken(rawToken);
      booking.paymentLinkExpiresAt = new Date(Date.now() + PAYMENT_LINK_TTL_HOURS * 3_600_000).toISOString();
      booking.updatedAt = now;
      return {
        ...booking,
        ...base,
        requestApproval: { rawToken, expiresAt: booking.paymentLinkExpiresAt },
      };
    }

    const now = new Date().toISOString();
    const previousStatus = booking.status;
    // REQUEST-mode booking that was never paid: cancelling it moves no money
    // (nothing was ever debited, the incubator was never credited).
    const requestUnpaid = booking.reservationMode === 'REQUEST' && !booking.paidAt;
    booking.status = input.status;
    booking.updatedAt = now;
    if (input.status === 'CANCELLED' && input.declineReason) {
      booking.declineReason = input.declineReason;
    }

    // Release every desk/office day this booking held so the availability
    // calendar frees up the moment the parent booking is cancelled. Linked by
    // bookingId (any source) — leaving them CONFIRMED would re-introduce the
    // exact "occupied desk still bookable" bug this feature fixes.
    if (input.status === 'CANCELLED') {
      for (const desk of d.deskBookings ?? []) {
        if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') {
          desk.status = 'CANCELLED';
        }
      }
    }

    // ── Wallet movements ─────────────────────────────────────────────────
    // Three disjoint payment models:
    //   • manual  — offline/cash with no online leg → never touches a wallet.
    //   • card    — guest / card-deposit bookings. The incubator wallet was
    //               moved at settlement (+online −commission, in card-payment.ts).
    //               On CANCEL we REVERSE exactly those two movements. We NEVER
    //               refund the user wallet — they paid by card (and any cash
    //               balance), so refunds are handled off-platform.
    //   • wallet  — registered online/cash via the Metwork wallet (escrow).
    const isManual = booking.paymentMethod === 'manual';
    const isCard = booking.paymentMethod === 'card';

    if (isCard) {
      // Reverse the settlement movements only if money actually moved (the
      // booking had been CONFIRMED/settled). A still-PENDING_PAYMENT card
      // intent never credited anyone, so cancelling it moves nothing.
      if (input.status === 'CANCELLED' && previousStatus === 'CONFIRMED' && incubator.managerId) {
        const incubatorWallet = ensureWallet(d, incubator.managerId);
        if (incubatorWallet.status !== 'FROZEN') {
          const online = booking.onlinePaidAmount ?? 0;
          const commission = booking.commissionAmount ?? 0;
          // Reverse the PAYOUT (−online). No clamp — a negative balance is an
          // allowed platform debt the incubator settles by recharging.
          if (online > 0) {
            incubatorWallet.balance -= online;
            incubatorWallet.updatedAt = now;
            const payoutReversal: TransactionRecord = {
              id: randomUUID(),
              walletId: incubatorWallet.id,
              userId: incubator.managerId,
              type: 'ADJUSTMENT',
              amount: -online,
              balanceAfter: incubatorWallet.balance,
              status: 'COMPLETED',
              description: `Booking payout reversed — ${booking.itemName}`,
              reference: `payout-reversal-${booking.id}`,
              provider: 'internal',
              providerTxnId: null,
              metadata: { bookingId: booking.id },
              createdAt: now,
              completedAt: now,
            };
            d.transactions.push(payoutReversal);
          }
          // Reverse the COMMISSION debit (+commission back to the incubator).
          if (commission > 0) {
            incubatorWallet.balance += commission;
            incubatorWallet.updatedAt = now;
            const commissionReversal: TransactionRecord = {
              id: randomUUID(),
              walletId: incubatorWallet.id,
              userId: incubator.managerId,
              type: 'ADJUSTMENT',
              amount: commission,
              balanceAfter: incubatorWallet.balance,
              status: 'COMPLETED',
              description: `Platform commission reversed — ${booking.itemName}`,
              reference: `commission-reversal-${booking.id}`,
              provider: 'internal',
              providerTxnId: null,
              metadata: { bookingId: booking.id },
              createdAt: now,
              completedAt: now,
            };
            d.transactions.push(commissionReversal);
          }
        }
      }
    } else if (!isManual && input.status === 'CONFIRMED' && booking.totalAmount > 0) {
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
    } else if (!isManual && !requestUnpaid && booking.userId && input.status === 'CANCELLED' && booking.totalAmount > 0) {
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
        // claw it back from their wallet. No clamp — a negative balance is an
        // allowed platform debt the incubator settles by recharging.
        if (previousStatus === 'CONFIRMED') {
          const incubatorWallet = ensureWallet(d, incubator.managerId!);
          incubatorWallet.balance = incubatorWallet.balance - booking.totalAmount;
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
      customerLocale: user?.locale ?? 'fr',
      requestApproval: null as null | { rawToken: string; expiresAt: string },
    };
  });

  if (result === 'NO_INCUBATOR') return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile');
  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Booking not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your booking');
  if (result === 'ALREADY_FINAL') return jsonError(409, 'ALREADY_FINAL', 'Booking is already in a final state');

  // Send notification emails + in-app (skip for offline bookings with no
  // platform user). Legacy transitions keep their fire-and-forget timing;
  // REQUEST-mode transitions are AWAITED below — a serverless lambda can
  // freeze after the response and drop void-fired work, and the pay-link
  // email IS the client's only way to complete a request booking.
  const notifyAfterPatch = (async () => {
    // ── REQUEST-mode approve: send the tokenized pay link, NOT the confirmed
    // email (the booking is APPROVED_UNPAID — nothing has been paid yet).
    // An idempotent re-approve has requestApproval === null and sends nothing.
    if (input.status === 'CONFIRMED' && result.status === 'APPROVED_UNPAID') {
      if (result.requestApproval && result.customerEmail) {
        const locale =
          result.customerLocale === 'en' ? 'en'
          : result.customerLocale === 'ar' ? 'ar'
          : 'fr';
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';
        const payUrl = `${appUrl}/${locale}/booking/${result.id}/pay?token=${result.requestApproval.rawToken}`;
        sendBookingApprovedPayEmail(result.customerEmail, {
          customerName: result.customerName,
          details: {
            bookingId:   result.id,
            itemName:    result.itemName,
            vendorName:  result.vendorName,
            startsAt:    result.startsAt,
            endsAt:      result.endsAt,
            totalAmount: result.totalAmount,
          },
          payUrl,
          expiresAt: result.requestApproval.expiresAt,
          lang: locale,
        });
        if (result.userId) {
          await createNotification({
            userId: result.userId,
            type: 'BOOKING_PENDING_PAYMENT',
            title: 'Booking approved — complete payment',
            body: `Your request for "${result.itemName}" was approved. Complete the payment from the link we emailed you to confirm it.`,
            href: '/dashboard/entrepreneur/bookings',
          });
        }
      }
      return;
    }

    // ── REQUEST-mode decline before payment: nothing was charged, so use the
    // unpaid-cancellation copy (no refund line) alongside the reason.
    if (input.status === 'CANCELLED' && result.reservationMode === 'REQUEST' && !result.paidAt) {
      if (result.customerEmail) {
        if (input.declineReason) {
          sendBookingDeclinedEmail(result.customerEmail, {
            customerName: result.customerName,
            bookingId: result.id,
            itemName: result.itemName,
            itemKind: result.itemKind,
            vendorName: result.vendorName,
            totalAmount: 0, // nothing was paid — suppresses the refund line
            declineReason: input.declineReason,
          });
        } else {
          const locale =
            result.customerLocale === 'en' ? 'en'
            : result.customerLocale === 'ar' ? 'ar'
            : 'fr';
          sendBookingCancelledUnpaidEmail(result.customerEmail, {
            customerName: result.customerName,
            bookingId: result.id,
            itemName: result.itemName,
            vendorName: result.vendorName,
          }, locale);
        }
      }
      if (result.userId) {
        await createNotification({
          userId: result.userId,
          type: 'BOOKING_CANCELLED',
          title: 'Booking request declined',
          body: `Your booking request for "${result.itemName}" was declined. Nothing was charged.`,
          href: '/dashboard/entrepreneur/bookings',
        });
      }
      return;
    }

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
  if (result.reservationMode === 'REQUEST') {
    try { await notifyAfterPatch; } catch { /* never break the transition response */ }
  } else {
    void notifyAfterPatch;
  }

  // Never expose the raw payment-link token (or its stored hash) to the
  // incubator — the link is the CLIENT's credential, delivered by email only.
  const bookingResponse: Record<string, unknown> = { ...result };
  delete bookingResponse.requestApproval;
  delete bookingResponse.paymentLinkTokenHash;
  return json({ booking: bookingResponse });
}

/* ── PUT — edit a manual/offline booking ── */
const editSchema = z.object({
  startsAt:    z.string().datetime(),
  endsAt:      z.string().datetime(),
  unit:        z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
  totalAmount: z.number().min(0),
  clientName:  z.string().min(1).max(120),
  clientEmail: z.string().email().max(200).optional().nullable(),
  notes:       z.string().max(500).optional().nullable(),
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = editSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const incubator = d.incubators.find((i) => i.managerId === guard.user.id);
    if (!incubator) return 'NO_INCUBATOR' as const;

    const booking = d.bookings.find((b) => b.id === id);
    if (!booking) return 'NOT_FOUND' as const;
    if (!bookingOwnedByIncubator(d, incubator.id, booking)) return 'FORBIDDEN' as const;
    if (!isManualBooking(booking)) return 'NOT_EDITABLE' as const;
    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') return 'ALREADY_FINAL' as const;

    // Re-check availability for SPACE bookings, excluding THIS booking so it
    // never conflicts with its own current slot. Blackouts + capacity apply.
    if (booking.itemKind === 'SPACE') {
      const space = (d.spaces ?? []).find((s) => s.id === booking.itemId);
      if (!space) return 'SPACE_NOT_FOUND' as const;
      const avail = checkSpaceAvailability({
        space,
        bookings: d.bookings.filter((b) => b.id !== booking.id),
        spaceId:  space.id,
        unit:     input.unit,
        startsAt: input.startsAt,
        endsAt:   input.endsAt,
      });
      if (!avail.ok) return avail.reason;
    }

    const now = new Date().toISOString();
    booking.startsAt    = input.startsAt;
    booking.endsAt      = input.endsAt;
    booking.unit        = input.unit;
    booking.quantity    = computeQuantity(input.unit, input.startsAt, input.endsAt);
    booking.totalAmount = Math.round(input.totalAmount);
    booking.clientName  = input.clientName.trim();
    booking.clientEmail = input.clientEmail ?? null;
    booking.notes       = input.notes ?? null;
    booking.updatedAt   = now;

    return {
      booking,
      customerEmail: booking.clientEmail ?? '',
      customerName:  booking.clientName ?? 'Unknown',
      vendorName:    booking.vendorName ?? incubator.name,
    };
  });

  if (typeof result === 'string') {
    switch (result) {
      case 'NO_INCUBATOR':    return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile');
      case 'NOT_FOUND':       return jsonError(404, 'NOT_FOUND', 'Booking not found');
      case 'FORBIDDEN':       return jsonError(403, 'FORBIDDEN', 'Not your booking');
      case 'NOT_EDITABLE':    return jsonError(409, 'NOT_EDITABLE', 'Only manual (offline) bookings can be edited');
      case 'ALREADY_FINAL':   return jsonError(409, 'ALREADY_FINAL', 'Booking is already in a final state');
      case 'SPACE_NOT_FOUND': return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
      case 'OVERLAP_CONFLICT':  return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked');
      case 'DATE_UNAVAILABLE':  return jsonError(409, 'DATE_UNAVAILABLE', 'This date is blocked. Unblock it in the availability calendar first.');
      case 'CAPACITY_EXCEEDED': return jsonError(409, 'CAPACITY_EXCEEDED', 'No capacity left for this slot');
      default:                return jsonError(400, 'BAD_REQUEST', result);
    }
  }

  // Notify the client of the change (manual bookings default to French).
  // Awaited inside a never-throwing helper so the edit is never rolled back.
  if (result.customerEmail) {
    await sendBookingUpdatedEmail(
      result.customerEmail,
      {
        customerName: result.customerName,
        bookingId:    result.booking.id,
        itemName:     result.booking.itemName,
        vendorName:   result.vendorName,
        startsAt:     result.booking.startsAt,
        endsAt:       result.booking.endsAt,
        totalAmount:  result.booking.totalAmount,
      },
      'fr',
    );
  }

  return json({ booking: result.booking });
}

/* ── DELETE — remove a manual/offline booking ── */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const incubator = d.incubators.find((i) => i.managerId === guard.user.id);
    if (!incubator) return 'NO_INCUBATOR' as const;

    const idx = d.bookings.findIndex((b) => b.id === id);
    if (idx === -1) return 'NOT_FOUND' as const;
    const booking = d.bookings[idx]!;
    if (!bookingOwnedByIncubator(d, incubator.id, booking)) return 'FORBIDDEN' as const;
    if (!isManualBooking(booking)) return 'NOT_DELETABLE' as const;

    // Capture for the cancellation email before removing the record. A manual
    // booking has no transactions/wallet movements, so there is nothing to
    // reverse — the booking IS the only record.
    const captured = {
      bookingId:     booking.id,
      itemName:      booking.itemName,
      customerEmail: booking.clientEmail ?? '',
      customerName:  booking.clientName ?? 'Unknown',
      vendorName:    booking.vendorName ?? incubator.name,
    };
    // Release any desk/office holds this manual booking placed — otherwise the
    // unit stays blocked forever after the parent booking is deleted.
    for (const desk of d.deskBookings ?? []) {
      if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') {
        desk.status = 'CANCELLED';
      }
    }
    d.bookings.splice(idx, 1);
    return captured;
  });

  if (typeof result === 'string') {
    switch (result) {
      case 'NO_INCUBATOR':  return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile');
      case 'NOT_FOUND':     return jsonError(404, 'NOT_FOUND', 'Booking not found');
      case 'FORBIDDEN':     return jsonError(403, 'FORBIDDEN', 'Not your booking');
      case 'NOT_DELETABLE': return jsonError(409, 'NOT_DELETABLE', 'Only manual (offline) bookings can be deleted');
      default:              return jsonError(400, 'BAD_REQUEST', result);
    }
  }

  // Notify the client their booking was cancelled (manual → French).
  if (result.customerEmail) {
    await sendBookingProviderCancelledEmail(
      result.customerEmail,
      {
        customerName: result.customerName,
        bookingId:    result.bookingId,
        itemName:     result.itemName,
        vendorName:   result.vendorName,
      },
      'fr',
    );
  }

  return json({ ok: true });
}
