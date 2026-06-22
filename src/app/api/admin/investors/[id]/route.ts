/**
 * PATCH /api/admin/investors/:id — approve or reject an investor (admin only).
 *
 *   { status: 'APPROVED' }                       → grant full access + email
 *   { status: 'REJECTED', reason: '<text>' }     → block gated surfaces + email
 *
 * Delegates to the shared `setAccountApproval` service so the unified approval
 * gate (`approvalStatus`) and the legacy investor gate (`investorStatus`) stay
 * in sync regardless of which admin surface performs the action. Email sends
 * are fire-and-forget and never block/fail the response.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { setAccountApproval } from '@/server/auth/approval';
import { db } from '@/server/db/store';
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

  // Guard the surface to investors only (the dedicated investor admin page).
  const target = (await db.read()).users.find((u) => u.id === id);
  if (!target || target.role !== 'INVESTOR') {
    return jsonError(404, 'NOT_FOUND', 'Investor not found');
  }

  const result = await setAccountApproval({
    userId: id,
    decision: input.status,
    reason: input.reason,
    admin: { id: guard.user.id, email: guard.user.email },
  });

  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Investor not found');
  return json(result.user);
}
