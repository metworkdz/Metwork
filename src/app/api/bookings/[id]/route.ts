/**
 * PATCH /api/bookings/:id
 * Cancel a booking. Only the booking owner can cancel it, and only
 * when the booking is in PENDING or CONFIRMED state.
 *
 * Refund policy:
 *  - PENDING bookings: full wallet refund (funds were escrowed, incubator
 *    has not yet been credited).
 *  - CONFIRMED bookings: no automatic refund — user must contact the
 *    incubator directly.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { db, type TransactionRecord } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const result = await db.update((store) => {
    const booking = store.bookings.find((b) => b.id === id);
    if (!booking) return 'NOT_FOUND' as const;
    if (booking.userId !== guard.user.id) return 'FORBIDDEN' as const;
    // REQUEST-mode bookings can also be withdrawn by the owner before payment
    // (AWAITING_APPROVAL / APPROVED_UNPAID). No refund applies — nothing was
    // charged yet on those states.
    if (
      booking.status !== 'PENDING' &&
      booking.status !== 'CONFIRMED' &&
      booking.status !== 'AWAITING_APPROVAL' &&
      booking.status !== 'APPROVED_UNPAID'
    ) {
      return 'NOT_CANCELLABLE' as const;
    }

    const now = new Date().toISOString();
    const wasStatus = booking.status;
    booking.status = 'CANCELLED';
    booking.updatedAt = now;

    // Release any desk/office holds this booking placed so the availability
    // calendar frees up immediately (same rule as the incubator cancel path).
    for (const desk of store.deskBookings ?? []) {
      if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') {
        desk.status = 'CANCELLED';
      }
    }

    // Refund when the booking was still PENDING (incubator hasn't been credited).
    if (wasStatus === 'PENDING' && booking.totalAmount > 0) {
      const wallet = store.wallets.find((w) => w.userId === booking.userId);
      if (wallet && wallet.status !== 'FROZEN') {
        wallet.balance += booking.totalAmount;
        wallet.updatedAt = now;
        const refundTx: TransactionRecord = {
          id: randomUUID(),
          walletId: wallet.id,
          userId: booking.userId,
          type: 'REFUND',
          amount: booking.totalAmount,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: `Refund — ${booking.itemName} (user cancelled)`,
          reference: `cancel-${booking.id}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: { bookingId: booking.id },
          createdAt: now,
          completedAt: now,
        };
        store.transactions.push(refundTx);
      }
    }

    return booking;
  });

  if (result === 'NOT_FOUND')      return jsonError(404, 'NOT_FOUND', 'Booking not found');
  if (result === 'FORBIDDEN')      return jsonError(403, 'FORBIDDEN', 'Not your booking');
  if (result === 'NOT_CANCELLABLE') {
    return jsonError(409, 'NOT_CANCELLABLE', 'Booking cannot be cancelled in its current state');
  }

  return json({ booking: result });
}
