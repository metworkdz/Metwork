/**
 * GET  /api/admin/incubators   — list all incubators (admin only)
 * POST /api/admin/incubators   — create a new incubator (admin only)
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type IncubatorRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name:             z.string().min(2).max(120),
  email:            z.string().email().max(200),
  phone:            z.string().min(6).max(30),
  city:             z.string().min(1).max(80),
  website:          z.string().max(200).optional(),
  instagram:        z.string().max(200).optional(),
  status:           z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED']).default('ACTIVE'),
  subscriptionCode: z.enum(['COMMISSION', 'FLAT']).default('COMMISSION'),
});

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const incubators = (data.incubators ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ items: incubators, total: incubators.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
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
  const record = await db.update<IncubatorRecord>((d) => {
    if (!Array.isArray(d.incubators)) d.incubators = [];
    const inc: IncubatorRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      city: input.city.trim(),
      website: input.website?.trim() || null,
      instagram: input.instagram?.trim() || null,
      status: input.status,
      subscriptionCode: input.subscriptionCode,
      // Subscription fields — starts with no active subscription
      billingCycle:               null,
      subscriptionStatus:         'NONE',
      subscriptionPeriodStart:    null,
      subscriptionPeriodEnd:      null,
      subscriptionLastPaidAmount: null,
      createdAt: now,
      updatedAt: now,
    };
    d.incubators.push(inc);
    return inc;
  });

  return json(record, { status: 201 });
}
