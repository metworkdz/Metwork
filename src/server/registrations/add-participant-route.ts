/**
 * Shared HTTP handler for "add a participant recorded at the desk".
 *
 * Two surfaces expose it — the incubator dashboard and the consultant portal —
 * and they must behave identically: same validation, same error codes, same
 * capacity rule. The only thing that differs is which owner is acting, so the
 * route files resolve that and hand it in here.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { addOfflineRegistration } from '@/server/registrations/offline-registration';
import type { OwnerScope } from '@/server/registrations/service';

export const addParticipantSchema = z.object({
  entityType: z.enum(['PROGRAM', 'EVENT']),
  entityId: z.string().min(1),
  fullName: z.string().trim().min(1).max(200),
  // Required, unlike a manual booking's optional email. Seats are deduped by
  // address, and the confirmation cannot be sent without one.
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(1).max(50),
  answers: z
    .array(z.object({ fieldId: z.string().min(1), value: z.union([z.string(), z.array(z.string())]) }))
    .default([]),
  /** Cash taken at the desk. 0 is valid: seated now, pays later. */
  depositPaid: z.number().int().nonnegative().default(0),
  /** Overrides the listing's cash price when the host agreed a different one. */
  totalAmount: z.number().int().nonnegative().nullable().optional(),
  locale: z.string().max(10).nullable().optional(),
});

export async function handleAddParticipant(
  req: NextRequest,
  owner: OwnerScope,
  actorId: string,
) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = addParticipantSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await addOfflineRegistration({ ...input, owner, actorId });

  if (!result.ok) {
    // Narrow the carrying case FIRST: the other reasons share one member, so
    // eliminating them one literal at a time never narrows to this one.
    if (result.reason === 'MISSING_REQUIRED_FIELD') {
      return jsonError(422, 'MISSING_REQUIRED_FIELD', `Field "${result.label}" is required`, {
        fieldId: result.fieldId,
      });
    }
    if (result.reason === 'FULL') {
      return jsonError(409, 'FULL', 'No seats left — every place is taken.');
    }
    if (result.reason === 'ALREADY_REGISTERED') {
      return jsonError(409, 'ALREADY_REGISTERED', 'This email is already on the participants list.');
    }
    return jsonError(404, 'NOT_FOUND', 'Program or event not found');
  }

  return json(
    {
      registration: result.registration,
      totalAmount: result.totalAmount,
      depositPaid: result.depositPaid,
      dueOnSite: result.dueOnSite,
    },
    { status: 201 },
  );
}
