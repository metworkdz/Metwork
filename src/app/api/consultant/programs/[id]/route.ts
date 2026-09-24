/**
 * PATCH  /api/consultant/programs/[id] — update a consultant-owned program
 * DELETE /api/consultant/programs/[id] — delete one
 *
 * Authorization goes through the SAME canonical gate the incubator routes use
 * (`canEditProgram` / `canDeleteProgram`), with a MENTOR actor instead of a
 * USER one — so a consultant can only ever touch their own rows, and can never
 * reach an incubator-owned program.
 */
import type { NextRequest } from 'next/server';
import { CLOCK_TIME_PATTERN } from '@/lib/booking-when';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { pruneListingChildrenSync } from '@/server/registrations/service';
import { requireConsultant } from '@/server/mentors/access';
import { canDeleteProgram, canEditProgram, type ProgramActor } from '@/server/programs/ownership';
import { normalizeDepositConfig, validateCashDeposit } from '@/server/bookings/listing-payment';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isProgramSlugFree } from '@/server/programs/slug';
import { PROGRAM_DATES_ERRORS, resolveProgramDates } from '@/server/programs/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isoDate = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isNaN(Date.parse(s)),
    'Must be a valid date (YYYY-MM-DD or ISO 8601)',
  );

const patchSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  description: z.string().max(2000).optional(),
  type: z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP', 'WEBINAR']).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(8).optional(),
  // Pricing and payment config were absent from this schema entirely. Zod
  // strips unknown keys, so a consultant editing a price got a cheerful 200
  // and no change — the worst kind of failure, because nothing looked wrong.
  // Same shape as the incubator route, which always accepted them.
  price: z.number().int().nonnegative().optional(),
  onlinePrice: z.number().int().nonnegative().nullable().optional(),
  cashPrice: z.number().int().nonnegative().nullable().optional(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).optional(),
  cashDepositType:  z.enum(['FIXED', 'PERCENT']).optional().nullable(),
  cashDepositValue: z.number().int().nonnegative().optional().nullable(),
  seatsTotal: z.number().int().positive().optional(),
  deadline:  isoDate.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  startTime: z.string().regex(CLOCK_TIME_PATTERN, 'startTime must be HH:MM').nullable().optional(),
  endTime: z.string().regex(CLOCK_TIME_PATTERN, 'endTime must be HH:MM').nullable().optional(),
  endDate:   isoDate.nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
  visibility: z.enum(['PUBLIC', 'UNLISTED']).optional(),
  /** Dates still to confirm (true), or fixing them (false, with the dates). */
  datesTbc: z.boolean().optional(),
}).refine(
  (d) => {
    if (d.startDate && d.endDate && d.startDate >= d.endDate) return false;
    if (d.deadline && d.startDate && d.deadline > d.startDate) return false;
    return true;
  },
  { message: 'deadline must be ≤ startDate, and startDate must be < endDate' },
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const actor: ProgramActor = { kind: 'MENTOR', mentorId: guard.mentorId };

  const program = await db.update((d) => {
    const p = (d.programs ?? []).find((x) => x.id === id);
    if (!p) return null;
    if (canEditProgram(p, actor, d.incubators) !== 'ALLOW') return 'FORBIDDEN';
    // Checked before anything is written: the draft is saved whatever this
    // returns, so a refusal must come before the first change. The link has
    // to lead to exactly one program (server/programs/slug.ts).
    if (input.slug && input.slug !== p.slug && !isProgramSlugFree(d.programs, input.slug, p.id)) {
      return 'SLUG_TAKEN';
    }
    // Dates, decided on the merged state before anything is written too.
    const touchesDates = input.datesTbc !== undefined || input.deadline !== undefined
      || input.startDate !== undefined || input.endDate !== undefined;
    const dates = touchesDates ? resolveProgramDates(p, input, d.bookings) : null;
    if (dates && !dates.ok) return dates.reason;

    // Payment config: validate against the MERGED state (existing + patched),
    // so turning CASH on always carries a valid deposit and turning it off
    // clears one. Identical to the incubator route.
    if (
      input.acceptedPaymentMethods !== undefined ||
      input.cashDepositType !== undefined ||
      input.cashDepositValue !== undefined
    ) {
      const nextMethods = input.acceptedPaymentMethods ?? p.acceptedPaymentMethods ?? ['ONLINE'];
      const nextType  = input.cashDepositType  !== undefined ? input.cashDepositType  : (p.cashDepositType  ?? null);
      const nextValue = input.cashDepositValue !== undefined ? input.cashDepositValue : (p.cashDepositValue ?? null);
      if (validateCashDeposit(nextMethods, nextType, nextValue)) return 'INVALID_DEPOSIT';
      p.acceptedPaymentMethods = nextMethods;
      const cfg = normalizeDepositConfig(nextMethods, nextType, nextValue);
      p.cashDepositType  = cfg.cashDepositType;
      p.cashDepositValue = cfg.cashDepositValue;
    }

    if (input.title !== undefined) p.title = input.title;
    if (input.description !== undefined) p.description = input.description;
    if (input.type !== undefined) p.type = input.type;
    if (input.city !== undefined) p.city = input.city;
    if (input.imageUrl !== undefined) p.imageUrl = input.imageUrl ?? null;
    if (input.imageUrls !== undefined) {
      p.imageUrls = input.imageUrls;
      p.imageUrl = input.imageUrls[0] ?? null;
    }
    if (input.price !== undefined) p.price = input.price;
    if (input.onlinePrice !== undefined) p.onlinePrice = input.onlinePrice;
    if (input.cashPrice !== undefined) p.cashPrice = input.cashPrice;
    if (input.seatsTotal !== undefined) p.seatsTotal = input.seatsTotal;
    if (dates?.ok) {
      p.datesTbc = dates.value.datesTbc;
      p.deadline = dates.value.deadline;
      p.startDate = dates.value.startDate;
      p.endDate = dates.value.endDate;
    }
    if (input.startTime !== undefined) p.startTime = input.startTime;
    if (input.endTime !== undefined) p.endTime = input.endTime;
    if (input.status !== undefined) p.isActive = input.status === 'PUBLISHED';
    if (input.slug !== undefined) p.slug = input.slug ?? undefined;
    if (input.visibility !== undefined) p.visibility = input.visibility;
    p.updatedAt = new Date().toISOString();
    return p;
  });

  if (program === null) return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (program === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  if (program === 'INVALID_DEPOSIT') {
    return jsonError(422, 'INVALID_DEPOSIT', 'The cash deposit is not valid for these payment methods');
  }
  if (program === 'SLUG_TAKEN') {
    return jsonError(409, 'SLUG_TAKEN', 'Ce lien est déjà utilisé par un autre programme.');
  }
  if (program === 'DATES_REQUIRED' || program === 'DATES_ORDER' || program === 'HAS_BOOKINGS') {
    const [status, message] = PROGRAM_DATES_ERRORS[program];
    return jsonError(status, program, message);
  }
  return json({ program });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const actor: ProgramActor = { kind: 'MENTOR', mentorId: guard.mentorId };

  const result = await db.update((d) => {
    const programs = d.programs ?? [];
    const idx = programs.findIndex((x) => x.id === id);
    if (idx === -1) return 'NOT_FOUND';
    const decision = canDeleteProgram(programs[idx], actor, d.incubators);
    if (decision !== 'ALLOW') return decision;
    programs.splice(idx, 1);
    // Same mutation: the form and the registrations are meaningless
    // without the listing and were previously left orphaned.
    pruneListingChildrenSync(d, 'PROGRAM', id);
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  return json({ ok: true });
}
