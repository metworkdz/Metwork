/**
 * PATCH /api/admin/partners/[id]/space  — toggle one space's network-bookability.
 *
 * `id` is the IncubatorRecord.id (kept in the path for consistency with the
 * per-incubator partner resource). Body: { spaceId, networkBookable }.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { setSpaceNetworkBookable } from '@/server/network/partner-incubator-service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  spaceId:         z.string().min(1),
  networkBookable: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const result = await setSpaceNetworkBookable(
      input.spaceId,
      input.networkBookable,
      guard.user.id,
      guard.user.email,
    );
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Update failed';
    if (msg.includes('not found')) return jsonError(404, 'NOT_FOUND', msg);
    if (msg.includes('not an active partner')) return jsonError(400, 'NOT_ENROLLED', msg);
    return jsonError(400, 'UPDATE_FAILED', msg);
  }
}
