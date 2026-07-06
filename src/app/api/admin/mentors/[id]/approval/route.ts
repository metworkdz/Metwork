/**
 * PATCH /api/admin/mentors/:id/approval — approve or reject a consultant
 * (self-signed-up mentor). Admin only.
 *
 *   { status: 'APPROVED' }                    → publish the profile + email
 *   { status: 'REJECTED', reason: '<text>' }  → keep hidden + email
 *
 * Thin wrapper over the shared `setMentorApproval` service — mirrors the
 * account-approval route (PATCH /api/admin/accounts/:id/approval) verbatim.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { setMentorApproval } from '@/server/mentors/approval';
import { toMentorPrivateDto } from '@/server/mentors/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(2000).optional(),
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

  if (input.status === 'REJECTED' && !input.reason?.trim()) {
    return jsonError(400, 'REASON_REQUIRED', 'A rejection reason is required');
  }

  const result = await setMentorApproval({
    mentorId: id,
    decision: input.status,
    reason: input.reason,
    admin: { id: guard.user.id, email: guard.user.email },
  });

  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Mentor not found');

  return json(toMentorPrivateDto(result.mentor));
}
