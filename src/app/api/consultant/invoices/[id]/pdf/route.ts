/**
 * GET /api/consultant/invoices/[id]/pdf
 *
 * Streams the document as an A4 PDF, rendered exclusively from the stored
 * record — totals, amount-in-words and the whole letterhead were frozen when
 * it was issued. Same renderer and same templates as the incubator side.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { ownsInvoice } from '@/server/invoices/owner';
import { renderInvoicePdf } from '@/server/invoices/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const data = await db.read();
  const invoice = (data.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, guard.owner));
  if (!invoice) return jsonError(404, 'NOT_FOUND', 'Document introuvable');

  const pdf = await renderInvoicePdf(invoice);
  // The filename says which document it is — three lookalike PDFs in one
  // Downloads folder are otherwise told apart only by opening them.
  const stem = { FACTURE: 'Facture', PROFORMA: 'Proforma', DEVIS: 'Devis' }[invoice.kind ?? 'FACTURE'];
  const filename = `${stem}_${invoice.number.replace(/[\s/]+/g, '_')}.pdf`;

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
