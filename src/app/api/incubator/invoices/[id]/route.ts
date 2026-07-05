/**
 * GET   /api/incubator/invoices/[id]  — single invoice (tenant-checked)
 * PATCH /api/incubator/invoices/[id]  — status → 'CANCELLED' only
 *
 * Invoices are legal documents: no field edits, ever. The correction path is
 * cancel + reissue.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.literal('CANCELLED'),
});

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

  try { patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

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
