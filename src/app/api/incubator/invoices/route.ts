/**
 * GET  /api/incubator/invoices  — list this incubator's documents (newest first)
 * POST /api/incubator/invoices  — issue a facture, proforma or devis
 *
 * Thin: authentication and whose id this is, then `issueInvoice()` does the
 * rest. That function is shared verbatim with the consultant portal, so what
 * counts as a valid Algerian invoice is defined once.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { issueInvoice, issueInvoiceSchema } from '@/server/invoices/issue';
import { invoicesFor, type InvoiceOwner } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const owner: InvoiceOwner = { type: 'INCUBATOR', id: inc.id };
  const invoices = invoicesFor(await db.read(), owner);
  return json({ items: invoices, total: invoices.length });
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
  try { input = issueInvoiceSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await issueInvoice({ type: 'INCUBATOR', id: inc.id }, input);
  if (!result.ok) return jsonError(result.status, result.code, result.message);
  return json(result.invoice, { status: 201 });
}
