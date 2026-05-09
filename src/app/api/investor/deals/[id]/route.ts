/**
 * PATCH /api/investor/deals/:id — update a tracked deal
 * DELETE /api/investor/deals/:id — remove a deal from the tracker
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  startupName:  z.string().min(1).max(120).optional(),
  amount:       z.number().int().min(0).optional(),
  equity:       z.number().min(0).max(100).optional(),
  status:       z.enum(['PROSPECTING', 'TERM_SHEET', 'DUE_DILIGENCE', 'CLOSED', 'PASSED']).optional(),
  notes:        z.string().max(2000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INVESTOR']);
  if (!guard.ok) return guard.response;

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
    if (!Array.isArray(d.investments)) d.investments = [];
    const inv = d.investments.find((i) => i.id === id);
    if (!inv) return 'NOT_FOUND' as const;
    if (inv.investorId !== guard.user.id) return 'FORBIDDEN' as const;

    if (input.startupName !== undefined) inv.startupName = input.startupName;
    if (input.amount      !== undefined) inv.amount      = input.amount;
    if (input.equity      !== undefined) inv.equity      = input.equity;
    if (input.status      !== undefined) inv.status      = input.status;
    if (input.notes       !== undefined) inv.notes       = input.notes;
    inv.updatedAt = new Date().toISOString();
    return inv;
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Deal not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your deal');
  return json({ deal: result });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INVESTOR']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const result = await db.update((d) => {
    if (!Array.isArray(d.investments)) d.investments = [];
    const idx = d.investments.findIndex((i) => i.id === id);
    if (idx === -1) return 'NOT_FOUND' as const;
    if (d.investments[idx]!.investorId !== guard.user.id) return 'FORBIDDEN' as const;
    d.investments.splice(idx, 1);
    return 'OK' as const;
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Deal not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your deal');
  return noContent();
}
