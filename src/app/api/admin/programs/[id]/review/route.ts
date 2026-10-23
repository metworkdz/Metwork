/**
 * PATCH /api/admin/programs/:id/review — approve or reject a consultant's
 * program. Admin only.
 *   { decision: 'APPROVE' }                    → reachable + listed on /programs
 *   { decision: 'REJECT', reason: '<text>' }   → hidden; the consultant sees why
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { reviewProgram } from '@/server/programs/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(1000).optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const result = await reviewProgram(id, input.decision, guard.user, input.reason);
  if (!result.ok) {
    if (result.reason === 'REASON_REQUIRED') return jsonError(422, 'REASON_REQUIRED', 'Indiquez la raison du refus : le consultant la verra.');
    if (result.reason === 'NOT_CONSULTANT') return jsonError(409, 'NOT_CONSULTANT', 'Seuls les programmes de consultants sont soumis à validation.');
    return jsonError(404, 'NOT_FOUND', 'Programme introuvable');
  }
  return json({ program: result.program });
}
