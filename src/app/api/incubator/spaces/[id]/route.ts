/**
 * PATCH  /api/incubator/spaces/[id]  — update a space
 * DELETE /api/incubator/spaces/[id]  — delete a space
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { validateCashDeposit, normalizeDepositConfig } from '@/server/bookings/listing-payment';
import {
  cleanDeskNames,
  validateDeskNames,
  validateDomiciliationSlots,
  validateDomiciliationPrice,
} from '@/server/spaces/category-fields';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  category: z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION']).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(8).optional(),
  pricePerHour: z.number().int().nonnegative().nullable().optional(),
  pricePerDay: z.number().int().nonnegative().nullable().optional(),
  pricePerMonth: z.number().int().nonnegative().nullable().optional(),
  pricePerHalfDay: z.number().int().nonnegative().nullable().optional(),
  halfDayStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  halfDayEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  cashPricePerHour: z.number().int().nonnegative().nullable().optional(),
  cashPricePerHalfDay: z.number().int().nonnegative().nullable().optional(),
  cashPricePerDay: z.number().int().nonnegative().nullable().optional(),
  cashPricePerMonth: z.number().int().nonnegative().nullable().optional(),
  capacity: z.number().int().positive().optional(),
  amenities: z.array(z.string()).optional(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).optional(),
  cashDepositType:  z.enum(['FIXED', 'PERCENT']).optional().nullable(),
  cashDepositValue: z.number().int().positive().optional().nullable(),
  durationDiscounts: z.array(z.object({
    unit:    z.enum(['HOUR', 'DAY']),
    minQty:  z.number().int().positive(),
    percent: z.number().int().min(1).max(99),
  })).max(20).optional(),
  // Category-specific fields (validated against the merged category below).
  deskNames:       z.array(z.string().max(60)).max(500).optional(),
  officePhotos:    z.array(z.string().url()).max(5).optional(),
  officeSize:      z.number().int().positive().nullable().optional(),
  officeFloor:     z.string().max(40).nullable().optional(),
  officeAmenities: z.array(z.string().max(60)).max(30).optional(),
  domiciliationSlots: z.number().int().positive().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  let depositError: string | null = null;
  let categoryError: string | null = null;
  const space = await db.update((d) => {
    const s = (d.spaces ?? []).find((x) => x.id === id);
    if (!s) return null;
    const incubator = d.incubators.find((i) => i.id === s.incubatorId);
    if (!incubator || incubator.managerId !== guard.user.id) return 'FORBIDDEN';
    // Category after the patch — drives the per-category rules below.
    const nextCategory = input.category ?? s.category;
    // Reject (before mutating) any edit that would leave a BOOKABLE space with
    // no price for any unit — that makes it unbookable. Domiciliation is
    // request-based and carries no per-unit price, so it is exempt.
    const nextHour    = input.pricePerHour    !== undefined ? input.pricePerHour    : s.pricePerHour;
    const nextHalfDay = input.pricePerHalfDay !== undefined ? input.pricePerHalfDay : s.pricePerHalfDay;
    const nextDay     = input.pricePerDay     !== undefined ? input.pricePerDay     : s.pricePerDay;
    const nextMonth   = input.pricePerMonth   !== undefined ? input.pricePerMonth   : s.pricePerMonth;
    if (
      nextCategory !== 'DOMICILIATION' &&
      nextHour == null && nextHalfDay == null && nextDay == null && nextMonth == null
    ) return 'NO_PRICE';

    // Category-specific validation against the merged state.
    if (nextCategory === 'COWORKING' && input.deskNames !== undefined) {
      categoryError = validateDeskNames(input.deskNames);
      if (categoryError) return 'INVALID_CATEGORY';
    }
    if (nextCategory === 'DOMICILIATION') {
      const nextSlots = input.domiciliationSlots !== undefined ? input.domiciliationSlots : s.domiciliationSlots;
      categoryError = validateDomiciliationSlots(nextSlots);
      if (categoryError) return 'INVALID_CATEGORY';
      // Monthly price is mandatory for domiciliation (validated on merged state).
      categoryError = validateDomiciliationPrice(nextMonth);
      if (categoryError) return 'INVALID_CATEGORY';
    }

    // Payment config: validate against the merged (existing + patched) state so
    // turning CASH on always carries a valid deposit, and turning it off clears
    // the deposit. Only runs when a payment field is actually being changed.
    if (
      input.acceptedPaymentMethods !== undefined ||
      input.cashDepositType !== undefined ||
      input.cashDepositValue !== undefined
    ) {
      const nextMethods = input.acceptedPaymentMethods ?? s.acceptedPaymentMethods ?? ['ONLINE'];
      const nextType  = input.cashDepositType  !== undefined ? input.cashDepositType  : (s.cashDepositType  ?? null);
      const nextValue = input.cashDepositValue !== undefined ? input.cashDepositValue : (s.cashDepositValue ?? null);
      depositError = validateCashDeposit(nextMethods, nextType, nextValue);
      if (depositError) return 'INVALID_DEPOSIT';
      s.acceptedPaymentMethods = nextMethods;
      const cfg = normalizeDepositConfig(nextMethods, nextType, nextValue);
      s.cashDepositType  = cfg.cashDepositType;
      s.cashDepositValue = cfg.cashDepositValue;
    }

    if (input.name !== undefined) s.name = input.name;
    if (input.description !== undefined) s.description = input.description;
    if (input.category !== undefined) s.category = input.category;
    if (input.city !== undefined) s.city = input.city;
    if (input.imageUrl !== undefined) s.imageUrl = input.imageUrl ?? null;
    // imageUrls wins when sent: it's the ordered gallery, cover = imageUrls[0].
    if (input.imageUrls !== undefined) {
      s.imageUrls = input.imageUrls;
      s.imageUrl = input.imageUrls[0] ?? null;
    }
    if (input.pricePerHour !== undefined) s.pricePerHour = input.pricePerHour ?? null;
    if (input.pricePerDay !== undefined) s.pricePerDay = input.pricePerDay ?? null;
    if (input.pricePerMonth !== undefined) s.pricePerMonth = input.pricePerMonth ?? null;
    if (input.pricePerHalfDay !== undefined) s.pricePerHalfDay = input.pricePerHalfDay ?? null;
    if (input.halfDayStart !== undefined) s.halfDayStart = input.halfDayStart ?? undefined;
    if (input.halfDayEnd !== undefined) s.halfDayEnd = input.halfDayEnd ?? undefined;
    if (input.cashPricePerHour !== undefined) s.cashPricePerHour = input.cashPricePerHour ?? null;
    if (input.cashPricePerHalfDay !== undefined) s.cashPricePerHalfDay = input.cashPricePerHalfDay ?? null;
    if (input.cashPricePerDay !== undefined) s.cashPricePerDay = input.cashPricePerDay ?? null;
    if (input.cashPricePerMonth !== undefined) s.cashPricePerMonth = input.cashPricePerMonth ?? null;
    if (input.capacity !== undefined) s.capacity = input.capacity;
    if (input.amenities !== undefined) s.amenities = input.amenities;
    if (input.durationDiscounts !== undefined) s.durationDiscounts = input.durationDiscounts;

    // Category-specific fields. Desk count drives coworking capacity so the two
    // can't diverge.
    if (input.deskNames !== undefined) {
      s.deskNames = cleanDeskNames(input.deskNames);
      if (nextCategory === 'COWORKING') s.capacity = s.deskNames.length;
    }
    if (input.officePhotos !== undefined) s.officePhotos = input.officePhotos;
    if (input.officeSize !== undefined) s.officeSize = input.officeSize ?? null;
    if (input.officeFloor !== undefined) s.officeFloor = input.officeFloor ?? null;
    if (input.officeAmenities !== undefined) s.officeAmenities = input.officeAmenities;
    if (input.domiciliationSlots !== undefined) s.domiciliationSlots = input.domiciliationSlots ?? null;

    if (input.status !== undefined) s.isActive = input.status === 'ACTIVE';
    s.updatedAt = new Date().toISOString();
    return s;
  });

  if (space === null) return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (space === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your space');
  if (space === 'NO_PRICE') return jsonError(400, 'NO_PRICE', 'At least one price (per hour, day, or month) is required');
  if (space === 'INVALID_DEPOSIT') return jsonError(400, 'INVALID_DEPOSIT', depositError ?? 'Invalid cash deposit configuration');
  if (space === 'INVALID_CATEGORY') return jsonError(400, 'INVALID_CATEGORY', categoryError ?? 'Invalid category fields');
  return json({ space });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const spaces = d.spaces ?? [];
    const idx = spaces.findIndex((x) => x.id === id);
    if (idx === -1) return 'NOT_FOUND';
    const incubator = d.incubators.find((i) => i.id === spaces[idx]!.incubatorId);
    if (!incubator || incubator.managerId !== guard.user.id) return 'FORBIDDEN';
    spaces.splice(idx, 1);
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your space');
  return json({ ok: true });
}
