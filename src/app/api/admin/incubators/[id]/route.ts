/**
 * PATCH /api/admin/incubators/[id]  — update incubator
 * DELETE /api/admin/incubators/[id] — remove incubator
 * Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';

function normaliseWebsite(v: unknown): unknown {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:             z.string().min(2).max(100).optional(),
  description:      z.string().max(500).optional(),
  city:             z.string().min(2).max(100).optional(),
  managerId:        z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  website:          z.preprocess(normaliseWebsite, z.string().url().nullable().optional()),
  subscriptionTier: z.enum(['COMMISSION', 'FLAT']).optional(),
  status:           z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
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

  const updated = await db.update((store) => {
    const inc = store.incubators.find((i) => i.id === id);
    if (!inc) return null;
    Object.assign(inc, input);
    inc.updatedAt = new Date().toISOString();
    return { ...inc };
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Incubator not found');

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'INCUBATOR_UPDATED',
    targetType: 'incubator',
    targetId: id,
    details: input as Record<string, unknown>,
  }).catch(() => undefined);

  return json({ incubator: updated });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const found = await db.update((store) => {
    const idx = store.incubators.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const removed = store.incubators.splice(idx, 1)[0];
    return removed?.name ?? '';
  });

  if (!found) return jsonError(404, 'NOT_FOUND', 'Incubator not found');

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'INCUBATOR_DELETED',
    targetType: 'incubator',
    targetId: id,
    details: { name: found },
  }).catch(() => undefined);

  return noContent();
}
