/**
 * GET   /api/incubator/invoices/[id]  — single invoice (tenant-checked)
 * PUT   /api/incubator/invoices/[id]  — edit a proforma / devis (same number)
 * PATCH /api/incubator/invoices/[id]  — { status: 'CANCELLED' } any document,
 *                                       or { withStamp } a proforma / devis
 *
 * A FACTURE is a legal document: no field edits, ever — the correction path
 * is cancel + reissue. Proformas and devis are not accounting records and may
 * be corrected (see @/server/invoices/drafts).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { handleDraftStamp, handleEditDraft } from '@/server/invoices/draft-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancel any document, or add/remove the stamp of a proforma or devis. */
const patchSchema = z.union([
  z.object({ status: z.literal('CANCELLED') }),
  z.object({ withStamp: z.boolean() }),
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;
  const data = await db.read();
  const invoice = (data.invoices ?? []).find(
    (i) => i.id === id && i.incubatorId === inc.id,
  );
  if (!invoice) return jsonError(404, 'NOT_FOUND', 'Invoice not found');

  return json({ invoice });
}

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

  let patch;
  try { patch = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  if ('withStamp' in patch) return handleDraftStamp({ type: 'INCUBATOR', id: inc.id }, id, patch.withStamp);

  const updated = await db.update((d) => {
    const invoice = (d.invoices ?? []).find(
      (i) => i.id === id && i.incubatorId === inc.id,
    );
    if (!invoice) return null;
    if (invoice.status !== 'CANCELLED') {
      invoice.status = 'CANCELLED';
      invoice.updatedAt = new Date().toISOString();
    }
    return invoice;
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Invoice not found');
  return json({ invoice: updated });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id } = await params;
  return handleEditDraft(req, { type: 'INCUBATOR', id: inc.id }, id);
}
