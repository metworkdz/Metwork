/**
 * GET  /api/incubator/services  — list services (seeding defaults on first call)
 * POST /api/incubator/services  — create a service
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type ServiceRecord, DEFAULT_SERVICES } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
});

/** Seed default services for an incubator that has none yet. */
async function ensureDefaultServices(incubatorId: string): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.services)) d.services = [];
    const has = d.services.some((s) => s.incubatorId === incubatorId);
    if (has) return;
    const now = new Date().toISOString();
    for (const svc of DEFAULT_SERVICES) {
      d.services.push({
        id:          randomUUID(),
        incubatorId,
        name:        svc.name,
        description: svc.description,
        isActive:    true,
        createdAt:   now,
        updatedAt:   now,
      });
    }
  });
}

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  await ensureDefaultServices(inc.id);

  const data = await db.read();
  const services = (data.services ?? [])
    .filter((s) => s.incubatorId === inc.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return json({ items: services, total: services.length });
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
  const record = await db.update<ServiceRecord>((d) => {
    if (!Array.isArray(d.services)) d.services = [];
    const svc: ServiceRecord = {
      id:          randomUUID(),
      incubatorId: inc.id,
      name:        input.name.trim(),
      description: input.description ?? null,
      isActive:    true,
      createdAt:   now,
      updatedAt:   now,
    };
    d.services.push(svc);
    return svc;
  });

  return json(record, { status: 201 });
}
