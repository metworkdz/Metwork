/**
 * POST /api/registrations
 *
 * Public endpoint — no authentication required for guests.
 * Authenticated users may submit with their session attached.
 *
 * FREE listings only. This route enrols without taking money, so a PAID
 * program or event is refused here (PAYMENT_REQUIRED) and must go through
 * POST /api/bookings/card with `registrationAnswers` instead — the seat is
 * then created at settlement, from the answers carried on the intent.
 *
 * Rate-limited on two keys: a generous per-IP budget (carrier NAT puts a whole
 * cohort on one address) and a tight per-email one (which is what actually
 * catches a script).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { createRegistration, findMissingRequiredAnswer } from '@/server/registrations/service';
import { resolveListingPricing } from '@/lib/listing-price';
import { applyClockTime, isClockTime } from '@/lib/booking-when';
import { readSession } from '@/server/auth/session';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registrationSchema = z.object({
  entityType: z.enum(['PROGRAM', 'EVENT']),
  entityId:   z.string().uuid(),
  fullName:   z.string().min(2).max(120).transform((s) => s.trim()),
  email:      z.string().email().transform((s) => s.trim().toLowerCase()),
  phone:      z.string().min(6).max(30).transform((s) => s.trim()),
  answers:    z.array(
    z.object({
      fieldId: z.string().uuid(),
      value:   z.union([z.string(), z.array(z.string())]),
    }),
  ).default([]),
  /** Locale the visitor filled the form in, carried onto the row for emails. */
  locale: z.enum(['en', 'fr', 'ar']).optional(),
  /**
   * 'CASH' reserves a seat on a paid listing that takes cash with NO deposit —
   * the host collects everything on site. Refused on any listing where there
   * IS something to charge online.
   */
  paymentMethod: z.enum(['CASH']).optional(),
});

/** Does this listing charge anything on EITHER payment surface? */
function isPaidListing(listing: {
  price: number;
  onlinePrice?: number | null;
  cashPrice?: number | null;
}): boolean {
  const p = resolveListingPricing(listing.price, listing);
  return p.online > 0 || p.cash > 0;
}

/**
 * May this PAID listing be reserved here, with the money collected on site?
 *
 * Only when it accepts CASH and has no deposit configured — i.e. there is
 * genuinely nothing to charge online. A listing with a deposit, or one that
 * takes card, must go through the checkout; otherwise this route would become
 * a way to skip a payment that IS collectable.
 */
function allowsCashOnSite(listing: {
  acceptedPaymentMethods?: string[] | null;
  cashDepositType?: string | null;
  cashDepositValue?: number | null;
}): boolean {
  const takesCash = listing.acceptedPaymentMethods?.includes('CASH') ?? false;
  const hasDeposit = listing.cashDepositType != null && listing.cashDepositValue != null;
  return takesCash && !hasDeposit;
}

export async function POST(req: NextRequest) {
  // Rate limit. The IP budget is deliberately generous: Algerian mobile
  // carriers put many subscribers behind one NAT address, and a training
  // promoted in a WhatsApp group puts a whole cohort on it at once. Five per
  // IP locked out the sixth real person. The tight limit that actually stops
  // abuse is the PER-EMAIL one — a single address retrying is a script, a
  // shared IP is a classroom.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await checkRateLimitDistributed(`reg:${ip}`, 60, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many registration attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = registrationSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Per-email budget — the limit that actually catches a script, without
  // punishing everyone who shares a carrier NAT with the submitter.
  if (!(await checkRateLimitDistributed(`reg-email:${input.email}`, 5, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many registration attempts. Please try again later.');
  }

  // Verify the entity exists and is active
  const data = await db.read();
  /** Set when this is a paid listing being reserved for cash on site. */
  let cashReservation: Parameters<typeof createRegistration>[0]['cashReservation'] = null;

  if (input.entityType === 'PROGRAM') {
    const prog = (data.programs ?? []).find((p) => p.id === input.entityId && p.isActive);
    if (!prog) return jsonError(404, 'NOT_FOUND', 'Program not found or inactive');
    // Deadline check
    if (new Date(prog.deadline) < new Date()) {
      return jsonError(409, 'DEADLINE_PASSED', 'The application deadline has passed');
    }
    // This endpoint enrols WITHOUT taking payment. A paid listing must go
    // through the card checkout (POST /api/bookings/card with
    // registrationAnswers) or a seat on a 22 000 DZD training could be claimed
    // by POSTing here directly. Checked on BOTH surfaces — either price being
    // positive makes the listing paid.
    if (isPaidListing(prog)) {
      // ...unless the host takes cash with no deposit, in which case there is
      // nothing to charge online and this IS the intended flow.
      if (!(input.paymentMethod === 'CASH' && allowsCashOnSite(prog))) {
        return jsonError(422, 'PAYMENT_REQUIRED', 'This program requires payment to register');
      }
      cashReservation = {
        listing: {
          id: prog.id,
          title: prog.title,
          vendorName: prog.incubatorName ?? prog.mentorName ?? 'Metwork',
          city: prog.city,
          startsAt: applyClockTime(prog.startDate, prog.startTime),
          startsAtHasClockTime: isClockTime(prog.startTime),
          endsAt: prog.endDate,
        },
        // The cash surface's price — never the online one.
        amountDue: resolveListingPricing(prog.price, prog).cash,
        clientReference: `cash-${prog.id}-${input.email}`,
      };
    }
  } else {
    const ev = (data.events ?? []).find((e) => e.id === input.entityId && e.isActive);
    if (!ev) return jsonError(404, 'NOT_FOUND', 'Event not found or inactive');
    if (isPaidListing(ev)) {
      if (!(input.paymentMethod === 'CASH' && allowsCashOnSite(ev))) {
        return jsonError(422, 'PAYMENT_REQUIRED', 'This event requires payment to register');
      }
      cashReservation = {
        listing: {
          id: ev.id,
          title: ev.title,
          vendorName: ev.incubatorName,
          city: ev.city,
          startsAt: ev.eventDate,
          endsAt: ev.eventDate,
        },
        amountDue: resolveListingPricing(ev.price, ev).cash,
        clientReference: `cash-${ev.id}-${input.email}`,
      };
    }
    // Past event check
    if (new Date(ev.eventDate) < new Date()) {
      return jsonError(409, 'EVENT_PASSED', 'This event has already taken place');
    }
  }

  // Validate required custom field answers (shared with the paid card route,
  // so a paid applicant can never skip a question a free one must answer).
  const missing = findMissingRequiredAnswer(data, input.entityType, input.entityId, input.answers);
  if (missing) {
    return jsonError(422, 'MISSING_REQUIRED_FIELD', `Field "${missing.label}" is required`, {
      fieldId: missing.fieldId,
    });
  }

  // Authenticated user session (optional)
  const session = await readSession();
  const userId = session?.user?.id ?? null;

  const { registration, alreadyRegistered } = await createRegistration({
    entityType: input.entityType,
    entityId: input.entityId,
    userId,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    answers: input.answers,
    locale: input.locale ?? session?.user?.locale ?? null,
    cashReservation,
  });

  if (alreadyRegistered) {
    return json(
      {
        registration,
        message: 'You are already registered for this event.',
        alreadyRegistered: true,
      },
      { status: 200 },
    );
  }

  return json({ registration, alreadyRegistered: false }, { status: 201 });
}
