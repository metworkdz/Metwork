/**
 * PATCH /api/admin/mentors/:id/visibility — publish a consultant to (or remove
 * them from) the public mentors page. Admin only.
 *
 *   { publiclyListed: true }   → show on /mentors + landing carousel
 *   { publiclyListed: false }  → hide from public lists (direct link keeps working)
 *
 * Publishing requires an APPROVED profile (422 otherwise). Thin wrapper over
 * the shared `setMentorPublished` service — mirrors the approval route.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { setMentorPublished } from '@/server/mentors/approval';
import { toMentorPrivateDto } from '@/server/mentors/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  publiclyListed: z.boolean(),
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
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await setMentorPublished({
    mentorId: id,
    publiclyListed: input.publiclyListed,
    admin: { id: guard.user.id, email: guard.user.email },
  });

  if (!result.ok) {
    if (result.reason === 'NOT_APPROVED') {
      return jsonError(422, 'NOT_APPROVED', 'Approve the consultant before publishing them.');
    }
    return jsonError(404, 'NOT_FOUND', 'Mentor not found');
  }

  return json(toMentorPrivateDto(result.mentor));
}
