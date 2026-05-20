/**
 * PATCH /api/admin/mentor-bookings/:id
 * Approve or reject a consultation booking request. Admin only.
 * Body: { status: 'APPROVED' | 'REJECTED', adminNote?: string }
 *
 * On APPROVED → sends confirmation PDF email to client.
 * On REJECTED → sends rejection email with optional admin note.
 * Only PENDING bookings can be reviewed (idempotency guard).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type MentorBookingRecord, type TransactionRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import {
  sendConsultationConfirmationEmail,
  sendConsultationRejectedEmail,
  sendMentorSessionConfirmedEmail,
} from '@/server/notifications/mock';
import { track } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  status:      z.enum(['APPROVED', 'REJECTED']),
  adminNote:   z.string().max(500).optional(),
  scheduledAt: z.string().datetime().optional(),
  meetLink:    z.string().url().optional(),
  /** True when the session will be held in-person instead of online. */
  isOffline:   z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Snapshot before update so we can find the mentor for emails
  const snapshot = await db.read();
  const existing = (snapshot.mentorBookings ?? []).find((b) => b.id === id);
  if (!existing) return jsonError(404, 'NOT_FOUND', 'Booking not found');

  // Idempotency: only PENDING bookings can be transitioned
  if (existing.status !== 'PENDING') {
    return jsonError(409, 'ALREADY_REVIEWED', 'This booking has already been reviewed');
  }

  // Pre-flight check (outside the lock): rejecting a PAID booking when the
  // user's wallet is FROZEN would silently lose the refund. Force the admin
  // to unfreeze first instead of pretending we processed it. Mirrors the
  // pattern used by the withdrawals admin route.
  if (
    input.status === 'REJECTED' &&
    existing.chargeType === 'PAID' &&
    (existing.amountCharged ?? 0) > 0
  ) {
    const userWallet = snapshot.wallets?.find((w) => w.userId === existing.userId);
    if (userWallet && userWallet.status === 'FROZEN') {
      return jsonError(
        409,
        'WALLET_FROZEN',
        'The user\'s wallet is frozen. Unfreeze it before rejecting so the refund can be issued.',
      );
    }
  }

  type Result =
    | { ok: true; booking: MentorBookingRecord; refundedAmount: number }
    | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_REVIEWED' };
  const result = await db.update<Result>((d) => {
    if (!Array.isArray(d.mentorBookings)) return { ok: false, reason: 'NOT_FOUND' };
    const booking = d.mentorBookings.find((b) => b.id === id);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };
    // Re-check under lock — another admin may have just acted on this booking.
    if (booking.status !== 'PENDING') return { ok: false, reason: 'ALREADY_REVIEWED' };

    const nowIso = new Date().toISOString();
    booking.status    = input.status;
    booking.adminNote = input.adminNote ?? null;
    if (input.scheduledAt) booking.scheduledAt = input.scheduledAt;
    if (input.meetLink)    booking.meetLink    = input.meetLink;
    if (input.isOffline !== undefined) booking.isOffline = input.isOffline;
    booking.updatedAt = nowIso;

    let refundedAmount = 0;

    // ── PAID + REJECTED → refund the user's wallet ──────────────────────
    // Idempotency: only refund if we haven't already issued one (in case of
    // partial replays). The PENDING→reviewed guard above already prevents
    // re-entry, but the refundTransactionId check is belt-and-braces.
    if (
      input.status === 'REJECTED' &&
      booking.chargeType === 'PAID' &&
      (booking.amountCharged ?? 0) > 0 &&
      !booking.refundTransactionId
    ) {
      const userWallet = (d.wallets ?? []).find((w) => w.userId === booking.userId);
      // We already checked FROZEN above; if the wallet is gone entirely
      // (shouldn't happen — it was debited at creation) we skip silently
      // rather than crash the rejection.
      if (userWallet && userWallet.status !== 'FROZEN') {
        const amount = booking.amountCharged ?? 0;
        userWallet.balance += amount;
        userWallet.updatedAt = nowIso;

        const refundTx: TransactionRecord = {
          id: randomUUID(),
          walletId: userWallet.id,
          userId: booking.userId ?? '',
          type: 'REFUND',
          amount,
          balanceAfter: userWallet.balance,
          status: 'COMPLETED',
          description: `Consultation rejected — refund`,
          reference: `consultation-refund-${booking.id.slice(0, 8)}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: {
            bookingItemKind: 'CONSULTATION',
            mentorBookingId: booking.id,
            originalTransactionId: booking.transactionId ?? null,
            adminNote: input.adminNote ?? null,
          },
          createdAt: nowIso,
          completedAt: nowIso,
        };
        d.transactions.push(refundTx);
        booking.refundTransactionId = refundTx.id;

        // Mark the original PAYMENT as REVERSED so the ledger reflects
        // that the funds round-tripped back to the user.
        if (booking.transactionId) {
          const originalTx = d.transactions.find((t) => t.id === booking.transactionId);
          if (originalTx) {
            originalTx.status = 'REVERSED';
            originalTx.completedAt = nowIso;
          }
        }
        refundedAmount = amount;
      }
    }

    // Sync the linked mentorConsultations row created at booking time for
    // FREE_QUOTA bookings. Without this, free-quota consultations linger as
    // PENDING (consuming quota) regardless of admin decision.
    if (booking.chargeType === 'FREE_QUOTA' && Array.isArray(d.mentorConsultations)) {
      const consultation =
        d.mentorConsultations.find((c) => c.bookingId === booking.id) ??
        // Fallback for rows created before bookingId was introduced
        d.mentorConsultations.find(
          (c) =>
            c.userId === booking.userId &&
            c.mentorId === booking.mentorId &&
            c.chargeType === 'FREE_QUOTA' &&
            c.quotaMonth === booking.freeQuotaMonth &&
            c.status === 'PENDING',
        );
      if (consultation) {
        if (input.status === 'APPROVED') {
          consultation.status = 'CONFIRMED';
          if (booking.scheduledAt) consultation.scheduledAt = booking.scheduledAt;
        } else {
          // REJECTED → release the free credit
          consultation.status = 'CANCELLED';
        }
        consultation.adminNote = input.adminNote ?? null;
        consultation.updatedAt = nowIso;
      }
    }

    return { ok: true, booking, refundedAmount };
  });

  if (!result.ok) {
    if (result.reason === 'ALREADY_REVIEWED') {
      return jsonError(409, 'ALREADY_REVIEWED', 'This booking has already been reviewed');
    }
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }

  // Send outcome email — fire-and-forget, never blocks response
  const mentor = await findMentorById(existing.mentorId);
  if (mentor) {
    // Resolve the client's preferred language (email templates support 'en' | 'fr' only)
    const data = await db.read();
    const client = data.users.find((u) => u.id === existing.userId);
    const lang: 'en' | 'fr' = client?.locale === 'en' ? 'en' : 'fr';

    if (input.status === 'APPROVED') {
      // Email + WhatsApp to client
      sendConsultationConfirmationEmail({ booking: result.booking, mentor, lang });
      // Email to mentor/consultant
      sendMentorSessionConfirmedEmail({ booking: result.booking, mentor, lang });
    } else {
      sendConsultationRejectedEmail({
        booking:   result.booking,
        mentor,
        adminNote: input.adminNote ?? null,
        lang,
      });
    }
  }

  // Analytics: fire the approval/rejection event for funnel tracking.
  // distinctId is the booking owner (existing.userId) — that's the user
  // whose funnel this affects, not the admin who acted.
  if (existing.userId) {
    if (input.status === 'APPROVED') {
      void track({
        event: 'booking_approved',
        distinctId: existing.userId,
        props: { bookingId: result.booking.id, itemKind: 'CONSULTATION' },
      });
    } else {
      void track({
        event: 'booking_rejected',
        distinctId: existing.userId,
        props: { bookingId: result.booking.id, refundedAmount: result.refundedAmount },
      });
    }
  }

  return json({
    ...result.booking,
    refundedAmount: result.refundedAmount,
  });
}
