/**
 * GET  /api/incubator/spaces  — list own spaces
 * POST /api/incubator/spaces  — create a new space
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import type { IncubatorSpaceCategory } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const spaceBodySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).default(''),
  category: z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION']),
  city: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  pricePerHour: z.number().int().nonnegative().nullable().optional(),
  pricePerDay: z.number().int().nonnegative().nullable().optional(),
  pricePerMonth: z.number().int().nonnegative().nullable().optional(),
  capacity: z.number().int().positive().default(1),
  amenities: z.array(z.string()).default([]),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
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
  const spaces = data.incubatorSpaces
    .filter((s) => s.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ spaces, total: spaces.length });
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
  try { input = spaceBodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const space = await db.update((d) => {
    const record = {
      id: randomUUID(),
      incubatorId: incubator.id,
      incubatorName: incubator.name,
      managerId: guard.user.id,
      name: input.name,
      description: input.description,
      category: input.category as IncubatorSpaceCategory,
      city: input.city,
      imageUrl: input.imageUrl ?? null,
      pricePerHour: input.pricePerHour ?? null,
      pricePerDay: input.pricePerDay ?? null,
      pricePerMonth: input.pricePerMonth ?? null,
      capacity: input.capacity,
      amenities: input.amenities,
      status: input.status as 'ACTIVE' | 'INACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    d.incubatorSpaces.push(record);
    return record;
  });

  return json({ space }, { status: 201 });
}
