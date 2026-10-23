/**
 * GET /api/messages/[id]/invoice/[invoiceId] — the PDF of a document shared in
 * a thread, for either participant. Same renderer as the owner's download.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { jsonError } from '@/server/http/json';
import { renderInvoicePdf } from '@/server/invoices/pdf';
import { sharedInvoice } from '@/server/messaging/service';
import { withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const { id, invoiceId } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'NOT_FOUND', 'Document not found');
  return withMessaging(async () => {
    const invoice = await sharedInvoice(guard.user.id, id, invoiceId);
    if (!invoice) return jsonError(404, 'NOT_FOUND', 'Document not found');
    const pdf = await renderInvoicePdf(invoice);
    const stem = { FACTURE: 'Facture', PROFORMA: 'Proforma', DEVIS: 'Devis' }[invoice.kind ?? 'FACTURE'];
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${stem}_${invoice.number.replace(/[\s/"]+/g, '_')}.pdf"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
      },
    });
  });
}
