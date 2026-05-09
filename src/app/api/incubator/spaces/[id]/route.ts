/**
 * PATCH  /api/incubator/spaces/[id]  — update a space
 * DELETE /api/incubator/spaces/[id]  — delete a space
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  category: z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION']).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  pricePerHour: z.number().int().nonnegative().nullable().optional(),
  pricePerDay: z.number().int().nonnegative().nullable().optional(),
  pricePerMonth: z.number().int().nonnegative().nullable().optional(),
  capacity: z.number().int().positive().optional(),
  amenities: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
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

  const space = await db.update((d) => {
    const s = d.incubatorSpaces.find((x) => x.id === id);
    if (!s) return null;
    if (s.managerId !== guard.user.id) return 'FORBIDDEN';
    if (input.name !== undefined) s.name = input.name;
    if (input.description !== undefined) s.description = input.description;
    if (input.category !== undefined) s.category = input.category;
    if (input.city !== undefined) s.city = input.city;
    if (input.imageUrl !== undefined) s.imageUrl = input.imageUrl ?? null;
    if (input.pricePerHour !== undefined) s.pricePerHour = input.pricePerHour ?? null;
    if (input.pricePerDay !== undefined) s.pricePerDay = input.pricePerDay ?? null;
    if (input.pricePerMonth !== undefined) s.pricePerMonth = input.pricePerMonth ?? null;
    if (input.capacity !== undefined) s.capacity = input.capacity;
    if (input.amenities !== undefined) s.amenities = input.amenities;
    if (input.status !== undefined) s.status = input.status;
    s.updatedAt = new Date().toISOString();
    return s;
  });

  if (space === null) return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (space === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your space');
  return json({ space });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const idx = d.incubatorSpaces.findIndex((x) => x.id === id);
    if (idx === -1) return 'NOT_FOUND';
    if (d.incubatorSpaces[idx]!.managerId !== guard.user.id) return 'FORBIDDEN';
    d.incubatorSpaces.splice(idx, 1);
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your space');
  return json({ ok: true });
}
