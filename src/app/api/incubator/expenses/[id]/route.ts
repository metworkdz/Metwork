/**
 * PATCH  /api/incubator/expenses/:id
 * DELETE /api/incubator/expenses/:id
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  amount:      z.number().int().min(1).optional(),
  category:    z.string().max(80).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    if (!Array.isArray(d.expenses)) d.expenses = [];
    const e = d.expenses.find((x) => x.id === id && x.incubatorId === inc.id);
    if (!e) return null;

    if (input.date        !== undefined) e.date        = input.date;
    if (input.title       !== undefined) e.title       = input.title.trim();
    if (input.description !== undefined) e.description = input.description;
    if (input.amount      !== undefined) e.amount      = input.amount;
    if (input.category    !== undefined) e.category    = input.category;
    e.updatedAt = new Date().toISOString();
    return e;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Expense not found');
  return json(result);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;
  await db.update((d) => {
    if (!Array.isArray(d.expenses)) d.expenses = [];
    d.expenses = d.expenses.filter((e) => !(e.id === id && e.incubatorId === inc.id));
  });

  return json({ ok: true });
}
