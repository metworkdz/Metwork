/**
 * PATCH /api/incubator/domiciliation/[id] — update a domiciliation request's
 * status (PENDING → CONTACTED → ACTIVE → REJECTED). Only the owning incubator
 * may update its requests.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['PENDING', 'CONTACTED', 'ACTIVE', 'REJECTED']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const reqRec = (d.domiciliationRequests ?? []).find((r) => r.id === id);
    if (!reqRec) return 'NOT_FOUND';
    const incubator = d.incubators.find((i) => i.id === reqRec.incubatorId);
    if (!incubator || (guard.user.role !== 'ADMIN' && incubator.managerId !== guard.user.id)) return 'FORBIDDEN';
    reqRec.status = input.status;
    return reqRec;
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Request not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your request');
  return json({ request: result });
}
