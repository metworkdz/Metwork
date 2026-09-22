/**
 * Shared handlers for correcting a registration and resending its paperwork.
 *
 * Both surfaces — the incubator dashboard and the consultant portal — show the
 * same participants table, so they are answered by the same handlers. Only the
 * owner differs, and the route files resolve that before calling in.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import {
  updateRegistration,
  resendRegistrationConfirmation,
  type OwnerScope,
} from '@/server/registrations/service';

/**
 * Name, email and phone. Nothing else is editable on purpose: this is for
 * fixing a typo, not for rewriting what somebody submitted.
 */
const editSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(4).max(30).optional(),
}).refine(
  (v) => v.fullName !== undefined || v.email !== undefined || v.phone !== undefined,
  { message: 'Nothing to change' },
);

export async function handleEditRegistration(req: NextRequest, owner: OwnerScope) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = editSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await updateRegistration(input.id, owner, {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
  });

  if (!result.ok) {
    return result.reason === 'NOT_FOUND'
      ? jsonError(404, 'NOT_FOUND', 'Registration not found')
      : jsonError(
          409, 'EMAIL_TAKEN',
          'Un autre participant de cette liste utilise déjà cette adresse e-mail.',
        );
  }

  return json({ registration: result.registration });
}

const resendSchema = z.object({ id: z.string().min(1) });

/**
 * Resending generates a PDF and sends up to two emails, so it is rate-limited
 * per registration: a host clicking four times in frustration would otherwise
 * send the client four identical copies.
 */
export async function handleResendRegistration(req: NextRequest, owner: OwnerScope) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = resendSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Keyed by OWNER as well as registration: keyed by id alone, anyone who
  // could guess an id could burn the real owner's quota without ever being
  // allowed to read the row.
  const ownerKey = owner.kind === 'MENTOR' ? `m:${owner.mentorId}` : `i:${owner.incubatorId}`;
  if (!(await checkRateLimitDistributed(`registration-resend:${ownerKey}:${input.id}`, 3, 60 * 60_000))) {
    return jsonError(
      429, 'RATE_LIMITED',
      'Confirmation déjà renvoyée plusieurs fois. Réessayez dans une heure.',
    );
  }

  const result = await resendRegistrationConfirmation(input.id, owner);
  if (!result.ok) return jsonError(404, 'NOT_FOUND', 'Registration not found');

  return json({
    ok: true,
    sentConfirmation: result.sentConfirmation,
    sentReceipt: result.sentReceipt,
  });
}
