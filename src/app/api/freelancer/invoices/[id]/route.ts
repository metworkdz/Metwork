/**
 * GET   /api/freelancer/invoices/[id] — one document (ownership-checked)
 * PUT   /api/freelancer/invoices/[id] — edit a proforma / devis (same number)
 * PATCH /api/freelancer/invoices/[id] — { status: 'CANCELLED' }, or { withStamp }
 *                                       on a proforma / devis
 *
 * A FACTURE is a legal record: no field edits, ever — cancel and reissue,
 * exactly as on the incubator side. Proformas and devis may be corrected.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { handleDraftStamp, handleEditDraft } from '@/server/invoices/draft-routes';
import { requireInvoicingFreelancer } from '@/server/invoices/freelancer-access';
import { ownsInvoice } from '@/server/invoices/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancel any document, or add/remove the stamp of a proforma or devis. */
const patchSchema = z.union([
  z.object({ status: z.literal('CANCELLED') }),
  z.object({ withStamp: z.boolean() }),
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const data = await db.read();
  const invoice = (data.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, guard.owner));
  if (!invoice) return jsonError(404, 'NOT_FOUND', 'Document introuvable');

  return json({ invoice });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let patch;
  try { patch = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  if ('withStamp' in patch) return handleDraftStamp(guard.owner, id, patch.withStamp);

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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleEditDraft(req, guard.owner, id);
}
