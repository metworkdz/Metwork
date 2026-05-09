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
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createProgramSchema = z.object({
  title:       z.string().min(2).max(120),
  description: z.string().min(10).max(2000),
  type:        z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP']),
  city:        z.string().min(1).max(80),
  imageUrl:    z.string().url().optional().nullable(),
  price:       z.number().int().min(0),
  seatsTotal:  z.number().int().min(1).max(10_000),
  deadline:    z.string().datetime(),
  startDate:   z.string().datetime(),
  endDate:     z.string().datetime(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).default(['ONLINE', 'CASH']),
});

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const programs = await listProgramsByIncubator(inc.id);
  return json({ items: programs, total: programs.length });
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
  try { input = createProgramSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const paymentMethods: ('ONLINE' | 'CASH')[] =
    inc.subscriptionCode === 'COMMISSION' ? ['ONLINE'] : input.acceptedPaymentMethods;

  const now = new Date().toISOString();
  const record = await db.update<ProgramRecord>((d) => {
    if (!Array.isArray(d.programs)) d.programs = [];
    const prog: ProgramRecord = {
      id:                     randomUUID(),
      incubatorId:            inc.id,
      incubatorName:          inc.name,
      title:                  input.title.trim(),
      description:            input.description.trim(),
      type:                   input.type,
      city:                   input.city.trim(),
      imageUrl:               input.imageUrl ?? null,
      price:                  input.price,
      seatsTotal:             input.seatsTotal,
      deadline:               input.deadline,
      startDate:              input.startDate,
      endDate:                input.endDate,
      acceptedPaymentMethods: paymentMethods,
      isActive:               true,
      createdAt:              now,
      updatedAt:              now,
    };
    d.programs.push(prog);
    return prog;
  });

  return json(record, { status: 201 });
}
