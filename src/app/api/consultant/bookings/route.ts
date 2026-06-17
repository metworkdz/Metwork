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
      message: b.message,
      scheduledAt: b.scheduledAt ?? null,
      durationMinutes: b.durationMinutes ?? null,
      meetingMode: b.meetingMode ?? null,
      meetingLink: b.meetingLink ?? null,
      amountCharged: b.amountCharged ?? 0,
      completedAt: b.completedAt ?? null,
      createdAt: b.createdAt,
    }));

  return json({ items, total: items.length });
}
