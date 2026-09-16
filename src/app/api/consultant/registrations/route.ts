/**
 * Registrants for a CONSULTANT-owned program.
 *
 *   GET   /api/consultant/registrations?entityId=  — list registrants
 *   POST  /api/consultant/registrations            — add a desk participant
 *   PATCH /api/consultant/registrations            — cancel one ({ id })
 *
 * Same `@/server/registrations/service` the incubator route uses, scoped to the
 * acting consultant instead of an incubator.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { cancelRegistration, deleteRegistration, mentorScope } from '@/server/registrations/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { handleAddParticipant } from '@/server/registrations/add-participant-route';
import { handleListRegistrations } from '@/server/registrations/list-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cancelSchema = z.object({
  id: z.string().uuid(),
  /** `true` removes a already-cancelled row for good. See the incubator route. */
  permanent: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (!entityId) return jsonError(400, 'MISSING_PARAM', 'entityId is required');

  const data = await db.read();
  const owned = (data.programs ?? []).some((p) => p.id === entityId && p.mentorId === guard.mentorId);
  if (!owned) return jsonError(403, 'FORBIDDEN', 'This program does not belong to you');

  // Same handler, same envelope, same filters as the incubator surface.
  return handleListRegistrations(req, mentorScope(guard.mentorId));
}

export async function PATCH(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = cancelSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const owner = mentorScope(guard.mentorId);

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

  // Scoped cancel — another owner's registration simply isn't found.
  const updated = await cancelRegistration(input.id, owner);
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Registration not found');
  return json({ registration: updated });
}

/**
 * POST — record a participant who signed up at the desk. Identical contract to
 * the incubator surface; only the owner scope differs.
 */
export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  return handleAddParticipant(req, mentorScope(guard.mentorId), guard.mentorId);
}

/**
 * DELETE — cancel a registration. Identical to PATCH above, which predates it;
 * the shared registrants table cancels with DELETE on both surfaces, so the
 * consultant route answers both verbs rather than making the client branch.
 */
export async function DELETE(req: NextRequest) {
  return PATCH(req);
}
