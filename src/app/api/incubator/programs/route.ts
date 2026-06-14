/**
 * GET  /api/incubator/programs  — list this incubator's programs
 * POST /api/incubator/programs  — create a new program
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type ProgramRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { listProgramsByIncubator } from '@/server/bookings/program-catalog';
import { validateCashDeposit, normalizeDepositConfig } from '@/server/bookings/listing-payment';
import { fromZod, json, jsonError } from '@/server/http/json';
import { slugify, uniqueSlug } from '@/lib/slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createProgramSchema = z.object({
  title:       z.string().min(2).max(120),
  description: z.string().min(10).max(2000),
  type:        z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP']),
  city:        z.string().min(1).max(80),
  imageUrl:    z.string().url().optional().nullable(),
  imageUrls:   z.array(z.string().url()).max(8).optional(),
  price:       z.number().int().min(0),
  seatsTotal:  z.number().int().min(1).max(10_000),
  deadline:    z.string().datetime(),
  startDate:   z.string().datetime(),
  endDate:     z.string().datetime(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).default(['ONLINE', 'CASH']),
  /** Cash deposit (paid online by card). Required when CASH is accepted. */
  cashDepositType:  z.enum(['FIXED', 'PERCENT']).optional().nullable(),
  cashDepositValue: z.number().int().positive().optional().nullable(),
  /** Optional custom slug. Auto-generated from title if omitted. */
  slug:        z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
});

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR', 'TRAINER']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const programs = await listProgramsByIncubator(inc.id);
  return json({ items: programs, total: programs.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'TRAINER']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createProgramSchema.parse(body); }
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
  const record = await db.update<ProgramRecord>((d) => {
    if (!Array.isArray(d.programs)) d.programs = [];

    // Slug: use provided value or auto-generate from title; ensure uniqueness per incubator
    const existingSlugs = d.programs
      .filter((p) => p.incubatorId === inc.id && p.slug)
      .map((p) => p.slug as string);
    const baseSlug = input.slug ? input.slug : slugify(input.title.trim());
    const slug = uniqueSlug(baseSlug, existingSlugs);

    const prog: ProgramRecord = {
      id:                     randomUUID(),
      incubatorId:            inc.id,
      incubatorName:          inc.name,
      title:                  input.title.trim(),
      description:            input.description.trim(),
      type:                   input.type,
      city:                   input.city.trim(),
      imageUrl:               coverUrl,
      imageUrls,
      price:                  input.price,
      seatsTotal:             input.seatsTotal,
      deadline:               input.deadline,
      startDate:              input.startDate,
      endDate:                input.endDate,
      acceptedPaymentMethods: paymentMethods,
      ...depositConfig,
      isActive:               true,
      slug,
      createdAt:              now,
      updatedAt:              now,
    };
    d.programs.push(prog);
    return prog;
  });

  return json(record, { status: 201 });
}
