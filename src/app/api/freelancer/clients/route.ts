/**
 * GET  /api/freelancer/clients — this freelancer's client book (newest first)
 * POST /api/freelancer/clients — add a client
 *
 * Same record, same rules and same code as the incubator side; only the owner
 * differs. The two books never mix.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { freelancerQuotaRefusal, requireInvoicingFreelancer } from '@/server/invoices/freelancer-access';
import { clientCreateSchema, createClient, listClients } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;

  const items = await listClients(guard.owner);
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireInvoicingFreelancer();
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

  const refusal = await freelancerQuotaRefusal(guard.user.id, 'client');
  if (refusal) return refusal;

  return json(await createClient(guard.owner, input), { status: 201 });
}
