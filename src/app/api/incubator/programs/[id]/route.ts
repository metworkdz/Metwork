/**
 * PATCH  /api/incubator/programs/[id]  — update a program
 * DELETE /api/incubator/programs/[id]  — delete a program
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
  type: z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP']).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  price: z.number().int().nonnegative().optional(),
  seatsTotal: z.number().int().positive().optional(),
  deadline: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
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

  const program = await db.update((d) => {
    const p = d.incubatorPrograms.find((x) => x.id === id);
    if (!p) return null;
    if (p.managerId !== guard.user.id) return 'FORBIDDEN';
    if (input.title !== undefined) p.title = input.title;
    if (input.description !== undefined) p.description = input.description;
    if (input.type !== undefined) p.type = input.type;
    if (input.city !== undefined) p.city = input.city;
    if (input.imageUrl !== undefined) p.imageUrl = input.imageUrl ?? null;
    if (input.price !== undefined) p.price = input.price;
    if (input.seatsTotal !== undefined) p.seatsTotal = input.seatsTotal;
    if (input.deadline !== undefined) p.deadline = input.deadline;
    if (input.startDate !== undefined) p.startDate = input.startDate;
    if (input.endDate !== undefined) p.endDate = input.endDate;
    if (input.status !== undefined) p.status = input.status;
    p.updatedAt = new Date().toISOString();
    return p;
  });

  if (program === null) return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (program === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  return json({ program });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const idx = d.incubatorPrograms.findIndex((x) => x.id === id);
    if (idx === -1) return 'NOT_FOUND';
    if (d.incubatorPrograms[idx]!.managerId !== guard.user.id) return 'FORBIDDEN';
    d.incubatorPrograms.splice(idx, 1);
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  return json({ ok: true });
}
