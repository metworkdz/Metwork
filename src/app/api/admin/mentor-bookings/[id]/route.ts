/**
 * PATCH /api/admin/mentor-bookings/:id
 * Approve or reject a consultation request. Admin only.
 *
 * On approval:
 * - meetLink OR isOffline must be provided (validation enforced here and in UI).
 * - Emails sent to BOTH client and mentor (idempotent via approvalEmailSentAt).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { createNotification } from '@/server/notifications/create-notification';
import {
  sendConsultationApprovedEmail,
  sendConsultationApprovedMentorEmail,
  sendConsultationRejectedEmail,
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

  // Enforce: approval requires meetLink OR isOffline
  if (input.status === 'APPROVED' && !input.meetLink && !input.isOffline) {
    return jsonError(
      422,
      'MEETING_REQUIRED',
      'Approval requires either a meeting link or marking the session as offline.',
    );
  }

  type Result = { ok: true; booking: Record<string, unknown> } | { ok: false };
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
    return { ok: true, booking: booking as unknown as Record<string, unknown> };
  });

  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Booking not found');

  const booking = result.booking;

  // Fire-and-forget notifications (deduplicated by approvalEmailSentAt)
  void (async () => {
    try {
      const data = await db.read();
      const mentor = data.mentors.find((m) => m.id === booking.mentorId as string);
      const alreadySent = !!(booking.approvalEmailSentAt as string | null | undefined);

      if (input.status === 'APPROVED' && !alreadySent) {
        // Mark as sent first to prevent duplicates on retry
        await db.update((d) => {
          const b = d.mentorBookings.find((x) => x.id === id);
          if (b) b.approvalEmailSentAt = new Date().toISOString();
        });

        const isOffline = !!(booking.isOffline as boolean | undefined);

        // Email to client
        sendConsultationApprovedEmail(booking.userEmail as string, {
          userName:    booking.userName as string,
          mentorName:  mentor?.fullName ?? 'your mentor',
          scheduledAt: (booking.scheduledAt as string | null) ?? null,
          meetLink:    isOffline ? null : ((booking.meetLink as string | null) ?? null),
          adminNote:   input.adminNote,
        });

        // Email to mentor (if they have an email address)
        if (mentor?.email) {
          sendConsultationApprovedMentorEmail(mentor.email, {
            mentorName:  mentor.fullName,
            clientName:  booking.userName as string,
            clientEmail: booking.userEmail as string,
            scheduledAt: (booking.scheduledAt as string | null) ?? null,
            meetLink:    isOffline ? null : ((booking.meetLink as string | null) ?? null),
            isOffline,
            adminNote:   input.adminNote,
          });
        }
      } else if (input.status === 'REJECTED' && !alreadySent) {
        await db.update((d) => {
          const b = d.mentorBookings.find((x) => x.id === id);
          if (b) b.approvalEmailSentAt = new Date().toISOString();
        });

        sendConsultationRejectedEmail(booking.userEmail as string, {
          userName:   booking.userName as string,
          mentorName: mentor?.fullName ?? 'your mentor',
          adminNote:  input.adminNote,
        });
      }

      if (booking.userId) {
        await createNotification({
          userId: booking.userId as string,
          type: input.status === 'APPROVED' ? 'MENTOR_BOOKING_APPROVED' : 'MENTOR_BOOKING_REJECTED',
          title: input.status === 'APPROVED' ? 'Consultation approved' : 'Consultation declined',
          body:
            input.status === 'APPROVED'
              ? `Your session with ${mentor?.fullName ?? 'your mentor'} is confirmed.`
              : `Your session request was declined.${input.adminNote ? ` Note: ${input.adminNote}` : ''}`,
          href: '/dashboard/entrepreneur/consultations',
        });
      }
    } catch {
      // non-critical
    }
  })();

  return json(result.booking);
}
