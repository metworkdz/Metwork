/**
 * GET  /api/incubator/income  — list income operations
 * POST /api/incubator/income  — create a manual income operation
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type IncomeRecord, type ClientRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clientId:      z.string().uuid().optional().nullable(),
  clientName:    z.string().min(1).max(120),
  serviceName:   z.string().min(1).max(120),
  serviceId:     z.string().uuid().optional().nullable(),
  amount:        z.number().int().min(0),
  paymentMethod: z.enum(['CASH', 'ONLINE', 'OTHER']).default('CASH'),
  notes:         z.string().max(1000).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const url = req.nextUrl;
  const from = url.searchParams.get('from');
  const to   = url.searchParams.get('to');

  const data = await db.read();
  let ops = (data.income ?? []).filter((o) => o.incubatorId === inc.id);

  if (from) ops = ops.filter((o) => o.date >= from);
  if (to)   ops = ops.filter((o) => o.date <= to);

  ops.sort((a, b) => b.date.localeCompare(a.date));
  return json({ items: ops, total: ops.length });
}

/** Upsert a client if clientId is provided; else find-or-create by name. */
function ensureClient(
  clients: ClientRecord[],
  incubatorId: string,
  clientId: string | null | undefined,
  clientName: string,
  now: string,
): { clientId: string; clientName: string } {
  if (clientId) {
    const existing = clients.find((c) => c.id === clientId && c.incubatorId === incubatorId);
    if (existing) return { clientId: existing.id, clientName: existing.fullName };
  }
  // Find by name (case-insensitive)
  const byName = clients.find(
    (c) => c.incubatorId === incubatorId && c.fullName.toLowerCase() === clientName.toLowerCase(),
  );
  if (byName) return { clientId: byName.id, clientName: byName.fullName };
  // Create minimal client
  const newClient: ClientRecord = {
    id:           randomUUID(),
    incubatorId,
    fullName:     clientName.trim(),
    email:        '',
    phone:        '',
    idCardNumber: null,
    companyName:  null,
    notes:        null,
    createdAt:    now,
    updatedAt:    now,
  };
  clients.push(newClient);
  return { clientId: newClient.id, clientName: newClient.fullName };
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

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
  const record = await db.update<IncomeRecord>((d) => {
    if (!Array.isArray(d.income))   d.income   = [];
    if (!Array.isArray(d.clients))  d.clients  = [];

    const { clientId, clientName } = ensureClient(
      d.clients, inc.id, input.clientId, input.clientName, now,
    );

    const op: IncomeRecord = {
      id:            randomUUID(),
      incubatorId:   inc.id,
      clientId,
      clientName,
      serviceName:   input.serviceName.trim(),
      serviceId:     input.serviceId ?? null,
      date:          input.date,
      amount:        input.amount,
      paymentMethod: input.paymentMethod,
      notes:         input.notes ?? null,
      importBatchId: null,
      bookingId:     null,
      createdAt:     now,
      updatedAt:     now,
    };
    d.income.push(op);
    return op;
  });

  return json(record, { status: 201 });
}
