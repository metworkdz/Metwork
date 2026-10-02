/**
 * GET  /api/incubator/clients  — list clients (newest first)
 * POST /api/incubator/clients  — create a client
 *
 * Thin over `@/server/invoices/clients`, which the consultant portal uses too:
 * one definition of the billing profile, the dedupe rule and the COMPANY rule.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { clientCreateSchema, createClient, listClients } from '@/server/invoices/clients';
import type { InvoiceOwner } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const owner: InvoiceOwner = { type: 'INCUBATOR', id: inc.id };
  const items = await listClients(owner);
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = clientCreateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const record = await createClient({ type: 'INCUBATOR', id: inc.id }, input);
  return json(record, { status: 201 });
}
