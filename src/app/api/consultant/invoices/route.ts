/**
 * GET  /api/consultant/invoices — this consultant's documents (newest first)
 * POST /api/consultant/invoices — issue a facture, proforma or devis
 *
 * Thin by design: the guard resolves whose documents these are, and
 * `issueInvoice()` — shared verbatim with the incubator route — does the rest,
 * so what counts as a valid Algerian invoice is defined once.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { issueInvoice, issueInvoiceSchema } from '@/server/invoices/issue';
import { findIssuer, invoicesFor, peekNextSeqFor } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const issuer = findIssuer(data, guard.owner);
  const invoices = invoicesFor(data, guard.owner);

  // The letterhead rides along so the portal can prefill the create form and
  // warn about missing legal details without a second round trip.
  return json({
    items: invoices,
    total: invoices.length,
    issuer: issuer?.profile ?? null,
    nextSeq: issuer ? peekNextSeqFor(issuer.counterHolder) : null,
  });
}

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = issueInvoiceSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await issueInvoice(guard.owner, input);
  if (!result.ok) return jsonError(result.status, result.code, result.message);
  return json(result.invoice, { status: 201 });
}
