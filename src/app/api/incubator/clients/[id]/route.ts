/**
 * PATCH  /api/incubator/clients/:id  — update a client
 * DELETE /api/incubator/clients/:id  — delete a client
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
  fullName:     z.string().min(2).max(120).optional(),
  email:        z.string().email().max(200).optional(),
  phone:        z.string().min(6).max(30).optional(),
  idCardNumber: z.string().max(30).nullable().optional(),
  companyName:  z.string().max(120).nullable().optional(),
  notes:        z.string().max(2000).nullable().optional(),
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
    if (!Array.isArray(d.clients)) d.clients = [];
    const c = d.clients.find((x) => x.id === id && x.incubatorId === inc.id);
    if (!c) return null;

    if (input.fullName     !== undefined) c.fullName     = input.fullName.trim();
    if (input.email        !== undefined) c.email        = input.email.trim().toLowerCase();
    if (input.phone        !== undefined) c.phone        = input.phone.trim();
    if (input.idCardNumber !== undefined) c.idCardNumber = input.idCardNumber;
    if (input.companyName  !== undefined) c.companyName  = input.companyName;
    if (input.notes        !== undefined) c.notes        = input.notes;
    c.updatedAt = new Date().toISOString();
    return c;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Client not found');
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
    if (!Array.isArray(d.clients)) d.clients = [];
    d.clients = d.clients.filter((c) => !(c.id === id && c.incubatorId === inc.id));
  });

  return json({ ok: true });
}
