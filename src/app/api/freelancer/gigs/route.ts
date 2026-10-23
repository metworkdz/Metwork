/** GET/POST /api/freelancer/gigs — fixed-price packages. Free plan: limited active gigs. */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { listGigs, saveGig } from '@/server/freelancers/workspace';
import { gigSchema } from '@/server/freelancers/workspace-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_GIGS = 50;

export async function GET() {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  return json({ items: listGigs(await db.read(), guard.user.id) });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = gigSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  if (listGigs(await db.read(), guard.user.id).length >= MAX_GIGS) {
    return jsonError(422, 'TOO_MANY_GIGS', 'Delete a gig first');
  }
  const result = await saveGig(guard.user.id, input);
  if (!result.ok) {
    return jsonError(403, 'PLAN_LIMIT_REACHED', 'Free plan limit reached — upgrade to Premium for unlimited gigs', { limit: result.limit ?? 0 });
  }
  return json(result.gig, { status: 201 });
}
