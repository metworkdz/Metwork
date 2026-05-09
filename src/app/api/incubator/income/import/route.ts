/**
 * POST /api/incubator/income/import
 *
 * Body: { rows: { date, clientName, serviceName, amount, paymentMethod? }[] }
 *
 * For each row:
 *   - Finds or creates a client by name.
 *   - Finds or creates a service by name.
 *   - Creates an IncomeRecord linked to both.
 * Invalid rows are skipped with a summary.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type ClientRecord, type ServiceRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rowSchema = z.object({
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clientName:    z.string().min(1).max(120),
  serviceName:   z.string().min(1).max(120),
  amount:        z.number().int().min(0),
  paymentMethod: z.enum(['CASH', 'ONLINE', 'OTHER']).optional().default('CASH'),
  notes:         z.string().max(500).optional().nullable(),
});

const bodySchema = z.object({
  rows: z.array(z.unknown()).max(5000),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = bodySchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();
  let imported = 0;
  let skipped  = 0;
  const errors: { row: number; reason: string }[] = [];

  await db.update((d) => {
    if (!Array.isArray(d.income))   d.income   = [];
    if (!Array.isArray(d.clients))  d.clients  = [];
    if (!Array.isArray(d.services)) d.services = [];

    // Build lookup maps (case-insensitive)
    const clientMap = new Map<string, ClientRecord>();
    for (const c of d.clients) {
      if (c.incubatorId === inc.id) clientMap.set(c.fullName.toLowerCase(), c);
    }
    const serviceMap = new Map<string, ServiceRecord>();
    for (const s of d.services) {
      if (s.incubatorId === inc.id) serviceMap.set(s.name.toLowerCase(), s);
    }

    input.rows.forEach((raw, idx) => {
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        errors.push({ row: idx + 1, reason: parsed.error.issues[0]?.message ?? 'Invalid row' });
        return;
      }
      const r = parsed.data;
      const nameKey = r.clientName.trim().toLowerCase();
      const svcKey  = r.serviceName.trim().toLowerCase();

      // Ensure client
      let client = clientMap.get(nameKey);
      if (!client) {
        client = {
          id:           randomUUID(),
          incubatorId:  inc.id,
          fullName:     r.clientName.trim(),
          email:        '',
          phone:        '',
          idCardNumber: null,
          companyName:  null,
          notes:        null,
          createdAt:    now,
          updatedAt:    now,
        };
        d.clients.push(client);
        clientMap.set(nameKey, client);
      }

      // Ensure service
      let service = serviceMap.get(svcKey);
      if (!service) {
        service = {
          id:          randomUUID(),
          incubatorId: inc.id,
          name:        r.serviceName.trim(),
          description: null,
          isActive:    true,
          createdAt:   now,
          updatedAt:   now,
        };
        d.services.push(service);
        serviceMap.set(svcKey, service);
      }

      d.income.push({
        id:            randomUUID(),
        incubatorId:   inc.id,
        clientId:      client.id,
        clientName:    client.fullName,
        serviceName:   service.name,
        serviceId:     service.id,
        date:          r.date,
        amount:        r.amount,
        paymentMethod: r.paymentMethod,
        notes:         r.notes ?? null,
        importBatchId: batchId,
        bookingId:     null,
        createdAt:     now,
        updatedAt:     now,
      });
      imported++;
    });
  });

  return json({ imported, skipped, errors, batchId });
}
