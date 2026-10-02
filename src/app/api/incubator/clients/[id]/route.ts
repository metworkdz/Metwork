/**
 * PATCH  /api/incubator/clients/:id  — update a client
 * DELETE /api/incubator/clients/:id  — delete a client
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { clientPatchSchema, deleteClient, updateClient } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  try { input = clientPatchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await updateClient({ type: 'INCUBATOR', id: inc.id }, id, input);
  if (!result) return jsonError(404, 'NOT_FOUND', 'Client not found');
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
  await deleteClient({ type: 'INCUBATOR', id: inc.id }, id);
  return json({ ok: true });
}
