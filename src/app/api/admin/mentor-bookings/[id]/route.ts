/**
 * PATCH /api/admin/mentor-bookings/:id
 * Approve or reject a booking request. Admin only.
 * Body: { status: 'APPROVED' | 'REJECTED', adminNote?: string }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  status:    z.enum(['APPROVED', 'REJECTED']),
  adminNote: z.string().max(500).optional(),
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

  type Result = { ok: true; booking: object } | { ok: false };
  const result = await db.update<Result>((d) => {
    if (!Array.isArray(d.mentorBookings)) return { ok: false };
    const booking = d.mentorBookings.find((b) => b.id === id);
    if (!booking) return { ok: false };
    booking.status    = input.status;
    booking.adminNote = input.adminNote ?? null;
    booking.updatedAt = new Date().toISOString();
    return { ok: true, booking };
  });

  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Booking not found');
  return json(result.booking);
}
