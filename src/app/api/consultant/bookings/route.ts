/**
 * GET /api/consultant/bookings — the consultant's instant-book consultations,
 * newest first.
 */
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  // The PIN (or magic-link fallback) IS the login — a valid consultant session
  // means full access to the consultant's own bookings, including client
  // contact details. The durable token + PIN gate happens at sign-in.
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const items = (data.mentorBookings ?? [])
    .filter((b) => b.mentorId === guard.mentorId && b.instantBook === true)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => ({
      id: b.id,
      status: b.status,
      userName: b.userName,
      userEmail: b.userEmail,
      userPhone: b.userPhone,
      message: b.message,
      scheduledAt: b.scheduledAt ?? null,
      durationMinutes: b.durationMinutes ?? null,
      meetingMode: b.meetingMode ?? null,
      meetingLink: b.meetingLink ?? null,
      amountCharged: b.amountCharged ?? 0,
      completedAt: b.completedAt ?? null,
      // P3: reschedule / cancel surface.
      source: b.source ?? 'registered',
      consultationDate: b.consultationDate ?? null,
      consultationTime: b.consultationTime ?? null,
      rescheduleCount: b.rescheduleCount ?? 0,
      createdAt: b.createdAt,
    }));

  return json({ items, total: items.length });
}
