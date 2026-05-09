/**
 * POST /api/admin/incubators
 * Create a new incubator profile. Admin only.
 */
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Normalise a website string: add https:// prefix when protocol is absent. */
function normaliseWebsite(v: unknown): unknown {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

const schema = z.object({
  name:             z.string().min(2).max(100),
  description:      z.string().max(500).default(''),
  city:             z.string().min(2).max(100),
  managerId:        z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().default(null)),
  website:          z.preprocess(normaliseWebsite, z.string().url().nullable().default(null)),
  subscriptionTier: z.enum(['COMMISSION', 'FLAT']).default('COMMISSION'),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const record = await db.update((store) => {
    const newRecord = {
      id: crypto.randomUUID(),
      ...input,
      logoUrl: null,
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    };
    store.incubators.push(newRecord);
    return newRecord;
  });

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'INCUBATOR_CREATED',
    targetType: 'incubator',
    targetId: record.id,
    details: { name: record.name },
  });

  return json({ incubator: record }, { status: 201 });
}
