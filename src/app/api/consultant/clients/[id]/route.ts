/**
 * PATCH  /api/consultant/clients/:id — update a client
 * DELETE /api/consultant/clients/:id — remove a client
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { clientPatchSchema, deleteClient, updateClient } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

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

  const updated = await updateClient(guard.owner, id, input);
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Client introuvable');
  return json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  await deleteClient(guard.owner, id);
  return json({ ok: true });
}
