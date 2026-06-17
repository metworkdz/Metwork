/**
 * POST /api/admin/consultations/:id/link  { mode, link? }
 *
 * Admin sets a meeting format on an instant-book consultation on the
 * consultant's behalf (AWAITING_LINK → READY). Admin-only. The READY
 * notification is sent by the lifecycle service (deduped).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { setBookingMeetingLink } from '@/server/consultations/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  mode: z.enum(['ONLINE', 'OFFLINE']),
  link: z.string().url().max(500).optional().nullable(),
});

export async function POST(
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

  const result = await setBookingMeetingLink({ bookingId: id, mode: input.mode, link: input.link ?? null });
  if (!result.ok) {
    if (result.reason === 'LINK_REQUIRED') return jsonError(422, 'LINK_REQUIRED', 'A meeting link is required for an online session');
    if (result.reason === 'WRONG_STATE') return jsonError(409, 'WRONG_STATE', 'This booking cannot accept a meeting link in its current state');
    if (result.reason === 'NOT_INSTANT_BOOK') return jsonError(409, 'NOT_INSTANT_BOOK', 'Not an instant-book consultation');
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }
  return json({ id: result.booking.id, status: result.booking.status, meetingMode: result.booking.meetingMode, meetingLink: result.booking.meetingLink });
}
