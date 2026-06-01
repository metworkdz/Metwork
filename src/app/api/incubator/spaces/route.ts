/**
 * GET  /api/incubator/spaces  — list this incubator's spaces
 * POST /api/incubator/spaces  — create a new space
 *
 * Commission-plan incubators: acceptedPaymentMethods is forced to ['ONLINE'].
 * Flat-plan incubators: may choose ['ONLINE'], ['CASH'], or ['ONLINE','CASH'].
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type SpaceRecord } from '@/server/db/store';
import { findIncubatorByUserEmail, getEffectiveSubscriptionCode } from '@/server/incubator/service';
import { listSpacesByIncubator } from '@/server/bookings/space-catalog';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSpaceSchema = z.object({
  name:         z.string().min(2).max(120),
  description:  z.string().min(10).max(2000),
  category:     z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION']),
  city:         z.string().min(1).max(80),
  imageUrl:     z.string().url().optional().nullable(),
  pricePerHour:  z.number().int().min(0).optional().nullable(),
  pricePerDay:   z.number().int().min(0).optional().nullable(),
  pricePerMonth: z.number().int().min(0).optional().nullable(),
  capacity:     z.number().int().min(1).max(10_000),
  amenities:    z.array(z.string().max(80)).max(30).default([]),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).default(['ONLINE', 'CASH']),
  /** Working days: 0=Sun…6=Sat. Defaults to Mon–Fri. */
  workingDays:  z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
  /** "HH:MM" 24h. */
  openingTime:  z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  closingTime:  z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
}).refine(
  // A space with no price for any unit is unbookable (availableUnits() would
  // be empty). Require at least one pricing unit, mirroring the program/event
  // price requirement.
  (d) => d.pricePerHour != null || d.pricePerDay != null || d.pricePerMonth != null,
  { message: 'At least one price (per hour, day, or month) is required', path: ['pricePerHour'] },
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
  const guard = await requireApiRole(['INCUBATOR']);
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

  // Commission-plan incubators can only accept ONLINE payment. Uses the
  // effective plan so a lapsed Pro plan reverts to ONLINE-only automatically.
  const paymentMethods: ('ONLINE' | 'CASH')[] =
    getEffectiveSubscriptionCode(inc) === 'COMMISSION' ? ['ONLINE'] : input.acceptedPaymentMethods;

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
      imageUrl:               input.imageUrl ?? null,
      pricePerHour:           input.pricePerHour ?? null,
      pricePerDay:            input.pricePerDay ?? null,
      pricePerMonth:          input.pricePerMonth ?? null,
      capacity:               input.capacity,
      amenities:              input.amenities,
      acceptedPaymentMethods: paymentMethods,
      workingDays:            input.workingDays,
      openingTime:            input.openingTime,
      closingTime:            input.closingTime,
      isActive:               true,
      createdAt:              now,
      updatedAt:              now,
    };
    d.spaces.push(space);
    return space;
  });

  return json(record, { status: 201 });
}
