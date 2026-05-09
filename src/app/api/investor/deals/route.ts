/**
 * GET  /api/investor/deals  — list the current investor's tracked deals
 * POST /api/investor/deals  — add a new deal to the tracker
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db, type InvestmentRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  startupName:  z.string().min(1).max(120),
  startupId:    z.string().uuid().optional().nullable(),
  amount:       z.number().int().min(0),
  equity:       z.number().min(0).max(100),
  status:       z.enum(['PROSPECTING', 'TERM_SHEET', 'DUE_DILIGENCE', 'CLOSED', 'PASSED']),
  notes:        z.string().max(2000).default(''),
});

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const deals = (data.investments ?? [])
    .filter((inv) => inv.investorId === guard.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ items: deals, total: deals.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const deal = await db.update((d) => {
    if (!Array.isArray(d.investments)) d.investments = [];
    const record: InvestmentRecord = {
      id:          randomUUID(),
      investorId:  guard.user.id,
      startupId:   input.startupId ?? null,
      startupName: input.startupName,
      amount:      input.amount,
      equity:      input.equity,
      status:      input.status,
      notes:       input.notes,
      createdAt:   now,
      updatedAt:   now,
    };
    d.investments.push(record);
    return record;
  });

  return json({ deal }, { status: 201 });
}
