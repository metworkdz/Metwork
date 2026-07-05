/**
 * GET /api/incubator/invoices/[id]/pdf
 *
 * Streams the invoice as an A4 PDF (template chosen at issue time). Renders
 * exclusively from the stored record — totals and amount-in-words were frozen
 * by the engine when the invoice was issued.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { renderInvoicePdf } from '@/server/invoices/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const pdf = await renderInvoicePdf(invoice);
  const filename = `Facture_${invoice.number.replace(/\//g, '_')}.pdf`;

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
}
