/**
 * GET  /api/incubator/spaces  — list this incubator's spaces
 * POST /api/incubator/spaces  — create a new space
 *
 * Every subscription plan may accept ['ONLINE'], ['CASH'], or ['ONLINE','CASH'].
 * When CASH is accepted a deposit (paid online by card) must be configured.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type SpaceRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { listSpacesByIncubator } from '@/server/bookings/space-catalog';
import { validateCashDeposit, normalizeDepositConfig } from '@/server/bookings/listing-payment';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSpaceSchema = z.object({
  name:         z.string().min(2).max(120),
  description:  z.string().min(10).max(2000),
  category:     z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION']),
  city:         z.string().min(1).max(80),
  imageUrl:     z.string().url().optional().nullable(),
  imageUrls:    z.array(z.string().url()).max(8).optional(),
  pricePerHour:  z.number().int().min(0).optional().nullable(),
  pricePerDay:   z.number().int().min(0).optional().nullable(),
  pricePerMonth: z.number().int().min(0).optional().nullable(),
  /** Optional flat half-day price + incubator-configured window ("HH:MM"). */
  pricePerHalfDay: z.number().int().min(0).optional().nullable(),
  halfDayStart:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  halfDayEnd:      z.string().regex(/^\d{2}:\d{2}$/).optional(),
  /** Optional CASH-booking per-unit prices — fall back to pricePer* when omitted. */
  cashPricePerHour:  z.number().int().min(0).optional().nullable(),
  cashPricePerHalfDay: z.number().int().min(0).optional().nullable(),
  cashPricePerDay:   z.number().int().min(0).optional().nullable(),
  cashPricePerMonth: z.number().int().min(0).optional().nullable(),
  capacity:     z.number().int().min(1).max(10_000),
  amenities:    z.array(z.string().max(80)).max(30).default([]),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).default(['ONLINE', 'CASH']),
  /** Cash deposit (paid online by card). Required when CASH is accepted. */
  cashDepositType:  z.enum(['FIXED', 'PERCENT']).optional().nullable(),
  cashDepositValue: z.number().int().positive().optional().nullable(),
  /** Working days: 0=Sun…6=Sat. Defaults to Mon–Fri. */
  workingDays:  z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
  /** "HH:MM" 24h. */
  openingTime:  z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  closingTime:  z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  /** Per-space duration discounts (0 < percent < 100, minQty > 0). */
  durationDiscounts: z.array(z.object({
    unit:    z.enum(['HOUR', 'DAY']),
    minQty:  z.number().int().positive(),
    percent: z.number().int().min(1).max(99),
  })).max(20).default([]),
}).refine(
  // A space with no price for any unit is unbookable (availableUnits() would
  // be empty). Require at least one pricing unit, mirroring the program/event
  // price requirement.
  (d) => d.pricePerHour != null || d.pricePerHalfDay != null || d.pricePerDay != null || d.pricePerMonth != null,
  { message: 'At least one price (per hour, half-day, day, or month) is required', path: ['pricePerHour'] },
);

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const spaces = await listSpacesByIncubator(inc.id);
  return json({ items: spaces, total: spaces.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSpaceSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Cash is allowed for every subscription plan; the deposit (and any platform
  // commission) is settled online — so we honor the incubator's choice as-is.
  const paymentMethods = input.acceptedPaymentMethods;

  const depositError = validateCashDeposit(paymentMethods, input.cashDepositType, input.cashDepositValue);
  if (depositError) return jsonError(400, 'INVALID_DEPOSIT', depositError);
  const depositConfig = normalizeDepositConfig(paymentMethods, input.cashDepositType, input.cashDepositValue);

  // Multi-image: imageUrls is the ordered gallery; imageUrls[0] is the cover.
  // Keep imageUrl in sync with the cover so legacy readers keep working.
  const imageUrls = input.imageUrls?.length ? input.imageUrls : (input.imageUrl ? [input.imageUrl] : []);
  const coverUrl = imageUrls[0] ?? null;

  const now = new Date().toISOString();
  const record = await db.update<SpaceRecord>((d) => {
    if (!Array.isArray(d.spaces)) d.spaces = [];
    const space: SpaceRecord = {
      id:                     randomUUID(),
      incubatorId:            inc.id,
      incubatorName:          inc.name,
      name:                   input.name.trim(),
      description:            input.description.trim(),
      category:               input.category,
      city:                   input.city.trim(),
      imageUrl:               coverUrl,
      imageUrls,
      pricePerHour:           input.pricePerHour ?? null,
      pricePerDay:            input.pricePerDay ?? null,
      pricePerMonth:          input.pricePerMonth ?? null,
      pricePerHalfDay:        input.pricePerHalfDay ?? null,
      halfDayStart:           input.halfDayStart,
      halfDayEnd:             input.halfDayEnd,
      cashPricePerHour:       input.cashPricePerHour ?? null,
      cashPricePerHalfDay:    input.cashPricePerHalfDay ?? null,
      cashPricePerDay:        input.cashPricePerDay ?? null,
      cashPricePerMonth:      input.cashPricePerMonth ?? null,
      capacity:               input.capacity,
      amenities:              input.amenities,
      acceptedPaymentMethods: paymentMethods,
      ...depositConfig,
      workingDays:            input.workingDays,
      openingTime:            input.openingTime,
      closingTime:            input.closingTime,
      durationDiscounts:      input.durationDiscounts,
      isActive:               true,
      createdAt:              now,
      updatedAt:              now,
    };
    d.spaces.push(space);
    return space;
  });

  return json(record, { status: 201 });
}
