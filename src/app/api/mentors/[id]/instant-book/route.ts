/**
 * POST /api/mentors/:id/instant-book
 *
 * Instant-book, pay-first consultation (feature-flagged via
 * CONSULTATION_INSTANT_BOOK — returns 404 when disabled). No admin approval.
 *
 * ACCOUNT-ONLY: consultations require a Metwork account and pay through Metwork
 * payments — an anonymous request is rejected with 401. The authenticated
 * member pays wallet-first (debit now if funded, else a SlickPay top-up of the
 * shortfall, settled on return). Pre-existing guest bookings created before this
 * gate still settle via the unchanged /consultation/pay/[token] flow.
 *
 * Server is authoritative on price (mentor fee × duration − tier − promo, or a
 * free credit). The client never supplies an amount.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { getServerSession } from '@/lib/session';
import { fromZod, json, jsonError } from '@/server/http/json';
import { validatePromoCode, promoAppliesToType } from '@/server/promo-codes/service';
import { getEffectiveMembershipCode, consultationDiscountFraction } from '@/server/memberships/service';
import { createInstantBooking, isInstantBookEnabled } from '@/server/consultations/instant-book';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ADVANCE_HOURS = 24;

const schema = z.object({
  // Contact identity is resolved server-side from the authenticated account
  // (see below). These stay accepted-but-optional so an older client that still
  // posts them — or the dashboard panel that sends an edited phone — keeps
  // working, while the new dialog can omit them entirely. Bounds only; the
  // strict shape checks are unnecessary because the session is authoritative.
  name:    z.string().max(120).optional().nullable(),
  email:   z.string().max(200).optional().nullable(),
  phone:   z.string().max(30).optional().nullable(),
  message: z.string().min(10).max(1000),
  consultationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  consultationTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  scheduledAt:      z.string().datetime({ offset: true }).optional().nullable(),
  durationMinutes:  z.number().int().min(30).max(180),
  promoCode:        z.string().max(50).optional().nullable(),
  locale:           z.enum(['en', 'fr', 'ar']).optional(),
  clientReference:  z.string().min(8).max(80).optional(),
});

function appBaseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin ?? 'http://localhost:3000';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInstantBookEnabled()) {
    return jsonError(404, 'NOT_FOUND', 'Not found');
  }

  const { id: mentorId } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const user = await getServerSession();

  // Consultations are account-only and must pass through Metwork payments —
  // guest booking is not permitted. The public booking UIs already bounce
  // anonymous visitors to /login; this is the authoritative server gate.
  if (!user) {
    return jsonError(401, 'LOGIN_REQUIRED', 'Please sign in to book a consultation.');
  }

  // 24-hour advance guard — only when a concrete slot was chosen.
  const scheduledIso =
    input.scheduledAt ??
    (input.consultationDate && input.consultationTime
      ? `${input.consultationDate}T${input.consultationTime}:00`
      : null);
  if (scheduledIso) {
    const scheduled = new Date(scheduledIso);
    if (Number.isNaN(scheduled.getTime())) {
      return jsonError(422, 'INVALID_DATE', 'Invalid consultation date/time');
    }
    if (scheduled.getTime() - Date.now() < MIN_ADVANCE_HOURS * 60 * 60 * 1000) {
      return jsonError(422, 'TOO_SOON', `Consultations must be booked at least ${MIN_ADVANCE_HOURS} hours in advance`);
    }
  }

  // Validate the promo code server-side (applicability only — consumed on settle).
  let promoDiscountPercent = 0;
  let appliedPromoCode: string | null = null;
  if (input.promoCode && input.promoCode.trim()) {
    const validation = await validatePromoCode(input.promoCode.trim());
    if (!validation.valid) {
      const msgs: Record<string, string> = {
        NOT_FOUND:     'Promo code not found',
        INACTIVE:      'Promo code is no longer active',
        EXPIRED:       'Promo code has expired',
        LIMIT_REACHED: 'Promo code has reached its usage limit',
      };
      return jsonError(422, 'INVALID_PROMO_CODE', msgs[validation.reason] ?? 'Invalid promo code');
    }
    if (!promoAppliesToType(validation.promoCode, 'CONSULTATION')) {
      return jsonError(422, 'INVALID_PROMO_CODE', 'This promo code does not apply to consultations');
    }
    promoDiscountPercent = validation.discountPercent;
    appliedPromoCode = validation.promoCode.code;
  }

  // Member-only: resolve the automatic membership-tier consultation discount
  // (Builder 15 % / Founder 20 %) from the ONE canonical resolver. The pricing
  // layer decides tier-vs-promo (no stacking) — this just supplies the fraction.
  const membershipDiscountFraction = user
    ? consultationDiscountFraction(getEffectiveMembershipCode(user))
    : 0;

  // Resolve the client's contact identity server-side from their account. The
  // new booking UI no longer asks a logged-in user to retype these; we fill from
  // the authenticated session. Fill-when-absent (not override): a client that
  // still supplies a value — e.g. the dashboard panel's editable phone — keeps
  // it. Empty string only if the account somehow lacks a field (safe fallback,
  // never a hard failure).
  const resolvedName  = input.name?.trim()  || user.fullName || '';
  const resolvedEmail = input.email?.trim() || user.email    || '';
  const resolvedPhone = input.phone?.trim() || user.phone    || '';

  const result = await createInstantBooking({
    mentorId,
    actor: user ? { id: user.id, membershipDiscountFraction } : null,
    name:    resolvedName,
    email:   resolvedEmail,
    phone:   resolvedPhone,
    message: input.message,
    durationMinutes:  input.durationMinutes,
    consultationDate: input.consultationDate ?? null,
    consultationTime: input.consultationTime ?? null,
    scheduledAt:      input.scheduledAt ?? null,
    appliedPromoCode,
    promoDiscountPercent,
    locale: input.locale,
    clientReference: input.clientReference ?? randomUUID(),
    appBaseUrl: appBaseUrl(req),
  });

  if (!result.ok) {
    if (result.reason === 'MENTOR_NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Mentor not found');
    if (result.reason === 'SLOT_NOT_BOOKABLE') {
      return jsonError(409, 'SLOT_UNAVAILABLE', 'That time slot is no longer available. Please pick another.');
    }
    if (result.reason === 'WALLET_FROZEN') {
      return jsonError(403, 'WALLET_FROZEN', 'Your wallet is currently frozen. Please contact support.');
    }
    return jsonError(502, 'PROVIDER_FAILED', result.message ?? 'Could not start the payment session');
  }

  if (result.mode === 'confirmed') {
    return json(
      { id: result.booking.id, status: result.booking.status, mode: 'confirmed' },
      { status: 201 },
    );
  }

  return json(
    {
      id: result.booking.id,
      status: result.booking.status,
      mode: 'awaiting_payment',
      payToken: result.payToken,
      redirectUrl: result.redirectUrl ?? null,
      amount: result.amount,
    },
    { status: 201 },
  );
}
