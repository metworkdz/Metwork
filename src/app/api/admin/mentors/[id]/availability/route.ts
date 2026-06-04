/**
 * PATCH /api/admin/mentors/:id/availability — ADMIN only.
 *
 * Replaces the mentor's weekly availability template, blocked dates, and
 * timezone in one shot. Validation (HH:MM, end > start, no overlaps, valid
 * IANA timezone) lives in `mentorAvailabilitySchema`. Returns the updated
 * mentor DTO so the admin UI can re-sync without a second fetch.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { mentorAvailabilitySchema } from '@/server/mentors/schemas';
import { updateMentorAvailability } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let patch;
  try {
    patch = mentorAvailabilitySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await updateMentorAvailability(id, patch);
  if (!result.ok) return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
  return json(toMentorDto(result.mentor));
}
