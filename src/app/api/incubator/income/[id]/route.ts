/**
 * PATCH  /api/incubator/income/:id
 * DELETE /api/incubator/income/:id
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
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clientName:    z.string().min(1).max(120).optional(),
  serviceName:   z.string().min(1).max(120).optional(),
  amount:        z.number().int().min(0).optional(),
  paymentMethod: z.enum(['CASH', 'ONLINE', 'OTHER']).optional(),
  notes:         z.string().max(1000).nullable().optional(),
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
    if (!Array.isArray(d.income)) d.income = [];
    const op = d.income.find((x) => x.id === id && x.incubatorId === inc.id);
    if (!op) return null;

    if (input.date          !== undefined) op.date          = input.date;
    if (input.clientName    !== undefined) op.clientName    = input.clientName.trim();
    if (input.serviceName   !== undefined) op.serviceName   = input.serviceName.trim();
    if (input.amount        !== undefined) op.amount        = input.amount;
    if (input.paymentMethod !== undefined) op.paymentMethod = input.paymentMethod;
    if (input.notes         !== undefined) op.notes         = input.notes;
    op.updatedAt = new Date().toISOString();
    return op;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Income record not found');
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
    if (!Array.isArray(d.income)) d.income = [];
    d.income = d.income.filter((o) => !(o.id === id && o.incubatorId === inc.id));
  });

  return json({ ok: true });
}
