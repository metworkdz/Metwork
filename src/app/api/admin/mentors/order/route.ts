/**
 * PUT /api/admin/mentors/order — the order of the mentors on the public site.
 *
 *   { ids: [mentorId, …] }  — exactly the mentors currently on the site, first
 *                              to last. Admin only.
 *
 * 409 STALE when the list no longer matches who is on the site (a mentor was
 * published or hidden meanwhile) — nothing is written; reload and retry.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { saveMentorPublicOrder } from '@/server/mentors/order';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(1000),
});

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
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

  const result = await saveMentorPublicOrder(input.ids, { id: guard.user.id, email: guard.user.email });
  if (!result.ok) {
    return result.reason === 'STALE'
      ? jsonError(409, 'STALE', 'La liste des mentors sur le site a changé. Rechargez la page.')
      : jsonError(422, 'INVALID', 'Chaque mentor doit apparaître une seule fois.');
  }
  return json({ order: result.order });
}
