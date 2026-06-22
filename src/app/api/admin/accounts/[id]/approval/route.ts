/**
 * PATCH /api/admin/accounts/:id/approval — approve or reject a gated account
 * (INCUBATOR / INVESTOR / BUSINESS). Admin only.
 *
 *   { status: 'APPROVED' }                    → lift the read-only gate + email
 *   { status: 'REJECTED', reason: '<text>' }  → keep read-only + email
 *
 * Thin wrapper over the shared `setAccountApproval` service — the single logic
 * path also used by the legacy investor route, so behaviour never diverges.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { setAccountApproval } from '@/server/auth/approval';
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

  const result = await setAccountApproval({
    userId: id,
    decision: input.status,
    reason: input.reason,
    admin: { id: guard.user.id, email: guard.user.email },
  });

  if (!result.ok) {
    if (result.reason === 'NOT_GATED') {
      return jsonError(400, 'NOT_GATED', 'This account type does not require approval');
    }
    return jsonError(404, 'NOT_FOUND', 'Account not found');
  }

  return json(result.user);
}
