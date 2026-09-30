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
import { deskPaymentOf, MAX_DESK_AMOUNT } from '@/server/bookings/desk-payment';
import { db } from '@/server/db/store';

/**
 * Name, email and phone — and, for a desk participant, the price and the
 * amount paid. Nothing else is editable on purpose: this is for fixing a typo
 * or recording money, not for rewriting what somebody submitted.
 */
const amount = z.number().int().min(0).max(MAX_DESK_AMOUNT);
const editSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(4).max(30).optional(),
  totalAmount: amount.optional(),
  paidAmount: amount.optional(),
}).refine(
  (v) => [v.fullName, v.email, v.phone, v.totalAmount, v.paidAmount].some((x) => x !== undefined),
  { message: 'Nothing to change' },
);

const REFUSALS = {
  NOT_FOUND: [404, 'Registration not found'],
  EMAIL_TAKEN: [409, 'Un autre participant de cette liste utilise déjà cette adresse e-mail.'],
  NO_BOOKING: [409, 'Ce participant n’a pas de réservation : il n’y a pas de montant à modifier.'],
  PAYMENT_NOT_EDITABLE: [409, 'Ce montant ne peut pas être modifié : le participant a payé en ligne, ou sa réservation n’est pas confirmée.'],
  PAID_EXCEEDS_TOTAL: [409, 'Le montant payé ne peut pas dépasser le prix.'],
} as const;

export async function handleEditRegistration(req: NextRequest, owner: OwnerScope, actorId: string) {
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
    totalAmount: input.totalAmount,
    paidAmount: input.paidAmount,
  }, actorId);

  if (!result.ok) {
    const [status, message] = REFUSALS[result.reason];
    return jsonError(status, result.reason, message);
  }

  // The row goes back with its booking's money, as the list serves it, so the
  // table shows the corrected amounts without a refetch.
  const data = await db.read();
  const booking = result.registration.bookingId
    ? (data.bookings ?? []).find((x) => x.id === result.registration.bookingId)
    : undefined;
  return json({
    registration: { ...result.registration, payment: booking ? deskPaymentOf(booking) : null },
  });
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
