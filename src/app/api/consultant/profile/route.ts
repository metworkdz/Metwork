/**
 * PATCH /api/consultant/profile — self-service profile editor.
 *
 * Accepts the consultant-editable profile fields: bio, expertise topics, the
 * display-only 30/60-min rates, the free-intro flag, and the instant-book
 * meeting defaults (mode + online link). The live per-hour `consultationFee`
 * is NOT editable here — it stays admin-controlled (it drives live charges).
 *
 * Profile fields route through the existing `updateMentor`; meeting defaults
 * through `updateMentorMeetingDefaults`. No new financial logic.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { requireConsultant } from '@/server/mentors/access';
import { consultantProfileSchema } from '@/server/mentors/schemas';
import { findMentorById, updateMentor, updateMentorMeetingDefaults } from '@/server/mentors/service';
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
  try { input = consultantProfileSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const { defaultMeetingMode, defaultMeetingLink, ...profile } = input;

  // Profile fields (bio/topics/rates/free-intro) — only when at least one is
  // present, to avoid a no-op write.
  if (Object.keys(profile).length > 0) {
    const result = await updateMentor(guard.mentorId, profile);
    if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  }

  // Meeting defaults — only when present.
  if (defaultMeetingMode !== undefined || defaultMeetingLink !== undefined) {
    const result = await updateMentorMeetingDefaults(guard.mentorId, {
      defaultMeetingMode,
      defaultMeetingLink,
    });
    if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  }

  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  return json({ mentor: toMentorDto(mentor) });
}
