/**
 * PATCH /api/admin/mentor-bookings/:id
 * Approve or reject a consultation booking request. Admin only.
 * Body: { status: 'APPROVED' | 'REJECTED', adminNote?: string }
 *
 * On APPROVED → sends confirmation PDF email to client.
 * On REJECTED → sends rejection email with optional admin note.
 * Only PENDING bookings can be reviewed (idempotency guard).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import {
  sendConsultationConfirmationEmail,
  sendConsultationRejectedEmail,
  sendMentorSessionConfirmedEmail,
} from '@/server/notifications/mock';

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

  type Result = { ok: true; booking: MentorBookingRecord } | { ok: false };
  const result = await db.update<Result>((d) => {
    if (!Array.isArray(d.mentorBookings)) return { ok: false };
    const booking = d.mentorBookings.find((b) => b.id === id);
    if (!booking) return { ok: false };
    booking.status    = input.status;
    booking.adminNote = input.adminNote ?? null;
    if (input.scheduledAt) booking.scheduledAt = input.scheduledAt;
    if (input.meetLink)    booking.meetLink    = input.meetLink;
    if (input.isOffline !== undefined) booking.isOffline = input.isOffline;
    booking.updatedAt = new Date().toISOString();
    return { ok: true, booking };
  });

  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Booking not found');

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

  return json(result.booking);
}
