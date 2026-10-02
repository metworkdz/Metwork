/**
 * GET   /api/consultant/invoices/[id] — one document (ownership-checked)
 * PATCH /api/consultant/invoices/[id] — status → 'CANCELLED' only
 *
 * A document is a legal record: no field edits, ever. The correction path is
 * cancel and reissue, exactly as on the incubator side.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { ownsInvoice } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({ status: z.literal('CANCELLED') });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const data = await db.read();
  const invoice = (data.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, guard.owner));
  if (!invoice) return jsonError(404, 'NOT_FOUND', 'Document introuvable');

  return json({ invoice });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  try { patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await db.update((d) => {
    const invoice = (d.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, guard.owner));
    if (!invoice) return null;
    if (invoice.status !== 'CANCELLED') {
      invoice.status = 'CANCELLED';
      invoice.updatedAt = new Date().toISOString();
    }
    return invoice;
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Document introuvable');
  return json({ invoice: updated });
}
