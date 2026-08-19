/**
 * Registrants for a CONSULTANT-owned program.
 *
 *   GET   /api/consultant/registrations?entityId=  — list registrants
 *   PATCH /api/consultant/registrations            — cancel one ({ id })
 *
 * Same `@/server/registrations/service` the incubator route uses, scoped to the
 * acting consultant instead of an incubator.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { listRegistrations, cancelRegistration, mentorScope } from '@/server/registrations/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cancelSchema = z.object({ id: z.string().uuid() });

export async function GET(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (!entityId) return jsonError(400, 'MISSING_PARAM', 'entityId is required');

  const data = await db.read();
  const owned = (data.programs ?? []).some((p) => p.id === entityId && p.mentorId === guard.mentorId);
  if (!owned) return jsonError(403, 'FORBIDDEN', 'This program does not belong to you');

  const registrations = await listRegistrations('PROGRAM', entityId, mentorScope(guard.mentorId));
  return json({ registrations, total: registrations.length });
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

  // Scoped cancel — another owner's registration simply isn't found.
  const updated = await cancelRegistration(input.id, mentorScope(guard.mentorId));
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Registration not found');
  return json({ registration: updated });
}
