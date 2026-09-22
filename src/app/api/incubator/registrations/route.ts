/**
 * GET  /api/incubator/registrations?entityType=&entityId=&page=&pageSize=&q=&status=
 *   — list registrations for a program or event
 * POST /api/incubator/registrations
 *   — record a participant who signed up at the desk (cash, deposit optional)
 * POST /api/incubator/registrations/edit
 *   — correct a participant's name / email / phone
 * DELETE /api/incubator/registrations/:id (via body { id })
 *   — cancel a registration
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { cancelRegistration, deleteRegistration, incubatorScope } from '@/server/registrations/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { handleAddParticipant } from '@/server/registrations/add-participant-route';
import { handleListRegistrations } from '@/server/registrations/list-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  // Same handler the consultant portal uses — one contract for one table.
  return handleListRegistrations(req, incubatorScope(inc.id));
}

const cancelSchema = z.object({
  id: z.string().uuid(),
  /**
   * `false` (the default) CANCELS — the long-standing meaning of DELETE on
   * this route, and what the Cancel button sends. `true` removes the row for
   * good, and the server refuses unless it is already cancelled.
   */
  permanent: z.boolean().optional(),
});

export async function DELETE(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = cancelSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const owner = incubatorScope(inc.id);

  if (input.permanent) {
    const result = await deleteRegistration(input.id, owner);
    if (!result.ok) {
      if (result.reason === 'NOT_CANCELLED') {
        return jsonError(409, 'NOT_CANCELLED', 'Cancel this registration before deleting it');
      }
      return jsonError(404, 'NOT_FOUND', 'Registration not found');
    }
    return json({ deleted: result.deleted });
  }

  const updated = await cancelRegistration(input.id, owner);
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Registration not found');

  return json({ registration: updated });
}

/**
 * POST — record a participant who signed up at the desk.
 *
 * The shared body schema and handler live in
 * `@/server/registrations/add-participant-route`, so the incubator and
 * consultant surfaces answer identically. Only the owner scope differs.
 */
export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  return handleAddParticipant(req, incubatorScope(inc.id), guard.user.id);
}
