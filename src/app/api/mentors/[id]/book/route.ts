/**
 * POST /api/mentors/:id/book
 * Submit a consultation booking request for a specific mentor.
 * Requires authentication.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name:    z.string().min(2).max(120),
  email:   z.string().email().max(200),
  phone:   z.string().min(6).max(30),
  message: z.string().min(10).max(1000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: mentorId } = await params;
  const mentor = await findMentorById(mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Mentor not found');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const booking = await db.update((d) => {
    const record = {
      id:        randomUUID(),
      mentorId,
      userId:    guard.user.id,
      userName:  input.name,
      userEmail: input.email,
      userPhone: input.phone,
      message:   input.message,
      status:    'PENDING' as const,
      adminNote: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];
    d.mentorBookings.push(record);
    return record;
  });

  return json({ id: booking.id, status: booking.status }, { status: 201 });
}
