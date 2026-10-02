/**
 * GET  /api/consultant/clients — this consultant's client book (newest first)
 * POST /api/consultant/clients — add a client
 *
 * Same record, same rules and same code as the incubator side; only the owner
 * differs. The two books never mix.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { clientCreateSchema, createClient, listClients } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const items = await listClients(guard.owner);
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = clientCreateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  return json(await createClient(guard.owner, input), { status: 201 });
}
