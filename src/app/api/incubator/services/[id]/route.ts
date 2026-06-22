/**
 * PATCH  /api/incubator/services/:id  — update a service
 * DELETE /api/incubator/services/:id  — archive (soft-delete) a service
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive:    z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
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
    if (!Array.isArray(d.services)) d.services = [];
    const s = d.services.find((x) => x.id === id && x.incubatorId === inc.id);
    if (!s) return null;

    if (input.name        !== undefined) s.name        = input.name.trim();
    if (input.description !== undefined) s.description = input.description;
    if (input.isActive    !== undefined) s.isActive    = input.isActive;
    s.updatedAt = new Date().toISOString();
    return s;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Service not found');
  return json(result);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;

  // Soft-delete: mark isActive = false
  const result = await db.update((d) => {
    if (!Array.isArray(d.services)) d.services = [];
    const s = d.services.find((x) => x.id === id && x.incubatorId === inc.id);
    if (!s) return null;
    s.isActive  = false;
    s.updatedAt = new Date().toISOString();
    return s;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Service not found');
  return json(result);
}
