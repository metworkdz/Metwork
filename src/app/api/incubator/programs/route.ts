/**
 * GET  /api/incubator/programs  — list own programs
 * POST /api/incubator/programs  — create a new program
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import type { IncubatorProgramType } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const programBodySchema = z.object({
  title: z.string().min(2).max(150),
  description: z.string().max(2000).default(''),
  type: z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP']),
  city: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  price: z.number().int().nonnegative().default(0),
  seatsTotal: z.number().int().positive().default(20),
  deadline: z.string().min(1), // ISO date string
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).default('DRAFT'),
});

async function findIncubator(userId: string) {
  const data = await db.read();
  return data.incubators.find((i) => i.managerId === userId) ?? null;
}

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const incubator = await findIncubator(guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  const data = await db.read();
  const programs = data.incubatorPrograms
    .filter((p) => p.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ programs, total: programs.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const incubator = await findIncubator(guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = programBodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const program = await db.update((d) => {
    const record = {
      id: randomUUID(),
      incubatorId: incubator.id,
      incubatorName: incubator.name,
      managerId: guard.user.id,
      title: input.title,
      description: input.description,
      type: input.type as IncubatorProgramType,
      city: input.city,
      imageUrl: input.imageUrl ?? null,
      price: input.price,
      seatsTotal: input.seatsTotal,
      deadline: input.deadline,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status as 'DRAFT' | 'PUBLISHED' | 'CLOSED',
      createdAt: now,
      updatedAt: now,
    };
    d.incubatorPrograms.push(record);
    return record;
  });

  return json({ program }, { status: 201 });
}
