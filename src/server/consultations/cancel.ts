/**
 * Consultant-initiated consultation cancellation (P3, members only).
 *
 * Owner-locked (2026-06-18): the consultant may cancel a settled, not-yet-
 * completed consultation for a REGISTERED member. The full amount is refunded to
 * the user's Metwork wallet (internal, instant — never a card refund) and the
 * consultant's held earning is reversed. A PAID GUEST booking is NOT cancellable
 * here (guests have no internal wallet) — those are handled by an admin out of
 * band, so this returns GUEST_UNSUPPORTED.
 *
 * Guarantees: the CANCELLED transition + refund are claimed in one atomic
 * mutation (idempotent — replays don't double-refund); the earning reversal,
 * slot release and client notification are non-blocking side effects.
 */
import { randomUUID } from 'node:crypto';
import { db, type MentorBookingRecord, type TransactionRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { voidPendingEarning } from '@/server/mentors/ledger';
import { releaseSlot } from '@/server/mentors/slot-lock';
import { sendConsultationCancelledEmail } from '@/server/notifications/mock';

/** Settled, not-yet-completed states a consultant may cancel. */
const CANCELLABLE = new Set<MentorBookingRecord['status']>(['READY', 'AWAITING_LINK', 'CONFIRMED']);

export type CancelResult =
  | { ok: true; booking: MentorBookingRecord; refundedAmount: number; replayed: boolean }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'NOT_INSTANT_BOOK' | 'WRONG_STATE' | 'GUEST_UNSUPPORTED' | 'WALLET_FROZEN';
    };

export async function cancelByConsultant(input: {
  bookingId: string;
  reason?: string | null;
}): Promise<CancelResult> {
  const pre = await db.read();
  const existing = (pre.mentorBookings ?? []).find((b) => b.id === input.bookingId);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  if (existing.instantBook !== true) return { ok: false, reason: 'NOT_INSTANT_BOOK' };
  if (existing.status === 'CANCELLED') {
    return { ok: true, booking: existing, refundedAmount: 0, replayed: true };
  }
  if (!CANCELLABLE.has(existing.status)) return { ok: false, reason: 'WRONG_STATE' };
  // Members only — a paid GUEST booking has no internal wallet to refund into.
  if (existing.source === 'guest') return { ok: false, reason: 'GUEST_UNSUPPORTED' };

  const refundAmount = existing.amountCharged ?? existing.guestAmountDue ?? 0;
  // Pre-flight: a FROZEN wallet can't take the refund — force the admin to
  // unfreeze first rather than silently lose it (mirrors admin reject/withdrawal).
  if (refundAmount > 0 && existing.userId) {
    const w = (pre.wallets ?? []).find((x) => x.userId === existing.userId);
    if (w && w.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
  }

  const result = await db.update<
    | { ok: true; booking: MentorBookingRecord; refundedAmount: number; claimed: boolean }
    | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' | 'WALLET_FROZEN' }
  >((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === input.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };
    if (booking.status === 'CANCELLED') {
      return { ok: true, booking, refundedAmount: 0, claimed: false };
    }
    if (!CANCELLABLE.has(booking.status)) return { ok: false, reason: 'WRONG_STATE' };

    const now = new Date().toISOString();
    let refundedAmount = 0;

    // Full refund to the user's Metwork wallet — only once (idempotency guard).
    const amount = booking.amountCharged ?? booking.guestAmountDue ?? 0;
    if (amount > 0 && booking.userId && !booking.refundTransactionId) {
      const wallet = (d.wallets ?? []).find((w) => w.userId === booking.userId);
      if (wallet && wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
      if (wallet) {
        wallet.balance += amount;
        wallet.updatedAt = now;
        if (!Array.isArray(d.transactions)) d.transactions = [];
        const refundTx: TransactionRecord = {
          id: randomUUID(),
          walletId: wallet.id,
          userId: booking.userId,
          type: 'REFUND',
          amount,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: 'Consultation cancelled by consultant — refund',
          reference: `consultation-cancel-refund-${booking.id.slice(0, 8)}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: {
            bookingItemKind: 'CONSULTATION',
            mentorBookingId: booking.id,
            originalTransactionId: booking.transactionId ?? null,
            cancelledBy: 'consultant',
          },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(refundTx);
        booking.refundTransactionId = refundTx.id;
        // Mark the original payment REVERSED so the ledger round-trips.
        if (booking.transactionId) {
          const orig = d.transactions.find((t) => t.id === booking.transactionId);
          if (orig) {
            orig.status = 'REVERSED';
            orig.completedAt = now;
          }
        }
        refundedAmount = amount;
      }
    }

    booking.status = 'CANCELLED';
    booking.cancelledAt = now;
    booking.cancelledBy = 'consultant';
    booking.cancelReason = input.reason ?? null;
    booking.updatedAt = now;
    return { ok: true, booking, refundedAmount, claimed: true };
  });

  if (!result.ok) return result;

  if (result.claimed) {
    // Reverse the consultant's held PENDING credit. Idempotent; NO_EARNING is
    // expected for free sessions (nothing was credited). Non-blocking.
    try {
      await voidPendingEarning({ mentorId: result.booking.mentorId, bookingId: result.booking.id });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[cancel] void earning failed for booking ${result.booking.id} (cancelled OK, reconcilable):`,
        err instanceof Error ? err.message : err,
      );
    }
    // Free any lingering slot hold.
    await releaseSlot(result.booking.id);
    // Notify the client (refund details) — fire-and-forget.
    const mentor = await findMentorById(result.booking.mentorId);
    if (mentor) {
      const lang: 'en' | 'fr' = result.booking.guestLocale === 'en' ? 'en' : 'fr';
      try {
        sendConsultationCancelledEmail({
          booking: result.booking,
          mentor,
          lang,
          refundedAmount: result.refundedAmount,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[cancel] notify failed for booking ${result.booking.id} (cancelled OK):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return {
    ok: true,
    booking: result.booking,
    refundedAmount: result.refundedAmount,
    replayed: !result.claimed,
  };
}
