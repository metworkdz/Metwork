/**
 * PATCH  /api/incubator/events/:id  — update an event
 * DELETE /api/incubator/events/:id  — delete an event
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  description: z.string().max(2000).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  price: z.number().int().nonnegative().optional(),
  isOnline: z.boolean().optional(),
  capacity: z.number().int().positive().optional(),
  eventDate: z.string().min(1).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']).optional(),
});

async function findIncubator(userId: string) {
  const data = await db.read();
  return data.incubators.find((i) => i.managerId === userId) ?? null;
}

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const incubator = await findIncubator(guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

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

  const updated = await db.update((d) => {
    const event = (d.incubatorEvents ?? []).find(
      (e) => e.id === id && e.incubatorId === incubator.id,
    );
    if (!event) return null;
    Object.assign(event, input, { updatedAt: new Date().toISOString() });
    return { ...event };
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Event not found');
  return json({ event: updated });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const incubator = await findIncubator(guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  const { id } = await params;

  const deleted = await db.update((d) => {
    const idx = (d.incubatorEvents ?? []).findIndex(
      (e) => e.id === id && e.incubatorId === incubator.id,
    );
    if (idx === -1) return false;
    d.incubatorEvents.splice(idx, 1);
    return true;
  });

  if (!deleted) return jsonError(404, 'NOT_FOUND', 'Event not found');
  return json({ ok: true });
}
