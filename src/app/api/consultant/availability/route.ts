/**
 * PATCH /api/consultant/availability — the consultant's self-service calendar
 * editor. Saves the weekly template + blocked dates + timezone (same rules and
 * service path as the admin editor) plus the two booking-policy knobs the editor
 * exposes: minNoticeHours and bufferMinutes.
 *
 * Reuses the existing `updateMentorAvailability` (+ `updateMentor` for the
 * policy knobs). No new financial logic; all fields nullable / back-compatible.
 * The consultant is resolved from the session cookie — no mentor id is trusted
 * from the client.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { requireConsultant } from '@/server/mentors/access';
import { consultantAvailabilitySchema } from '@/server/mentors/schemas';
import { findMentorById, updateMentor, updateMentorAvailability } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = consultantAvailabilitySchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const { minNoticeHours, bufferMinutes, ...availability } = input;

  const result = await updateMentorAvailability(guard.mentorId, availability);
  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Consultant not found');

  // Booking-policy knobs — only write when supplied.
  if (minNoticeHours !== undefined || bufferMinutes !== undefined) {
    const policy = await updateMentor(guard.mentorId, { minNoticeHours, bufferMinutes });
    if (!policy.ok) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  }

  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  return json({ mentor: toMentorDto(mentor) });
}
