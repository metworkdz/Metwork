/** PUT/DELETE /api/freelancer/gigs/[id] — owner-scoped. */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { deleteGig, saveGig } from '@/server/freelancers/workspace';
import { gigSchema } from '@/server/freelancers/workspace-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = gigSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const result = await saveGig(guard.user.id, input, id);
  if (result.ok) return json(result.gig);
  if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Gig not found');
  return jsonError(403, 'PLAN_LIMIT_REACHED', 'Free plan limit reached — upgrade to Premium for unlimited gigs', { limit: result.limit ?? 0 });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return (await deleteGig(guard.user.id, id)) ? json({ ok: true }) : jsonError(404, 'NOT_FOUND', 'Gig not found');
}
