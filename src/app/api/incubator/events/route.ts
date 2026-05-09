/**
 * GET  /api/incubator/events  — list own events
 * POST /api/incubator/events  — create a new event
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eventBodySchema = z.object({
  title: z.string().min(2).max(150),
  description: z.string().max(2000).default(''),
  city: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  price: z.number().int().nonnegative().default(0),
  isOnline: z.boolean().default(false),
  capacity: z.number().int().positive().default(50),
  eventDate: z.string().min(1), // ISO datetime string
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']).default('DRAFT'),
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
  const events = (data.incubatorEvents ?? [])
    .filter((e) => e.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ events, total: events.length });
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
  try { input = eventBodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const event = await db.update((d) => {
    if (!Array.isArray(d.incubatorEvents)) d.incubatorEvents = [];
    const record = {
      id: randomUUID(),
      incubatorId: incubator.id,
      incubatorName: incubator.name,
      managerId: guard.user.id,
      title: input.title,
      description: input.description,
      city: input.city,
      imageUrl: input.imageUrl ?? null,
      price: input.price,
      isOnline: input.isOnline,
      capacity: input.capacity,
      eventDate: input.eventDate,
      status: input.status as 'DRAFT' | 'PUBLISHED' | 'CANCELLED',
      createdAt: now,
      updatedAt: now,
    };
    d.incubatorEvents.push(record);
    return record;
  });

  return json({ event }, { status: 201 });
}
