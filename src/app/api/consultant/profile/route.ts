/**
 * PATCH /api/consultant/profile — set the consultant's instant-book meeting
 * defaults (mode + online link). Self-service.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { requireConsultant } from '@/server/mentors/access';
import { updateMentorMeetingDefaults } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  defaultMeetingMode: z.enum(['ONLINE', 'OFFLINE']).optional(),
  defaultMeetingLink: z.string().url().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await updateMentorMeetingDefaults(guard.mentorId, input);
  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  return json({ mentor: toMentorDto(result.mentor) });
}
