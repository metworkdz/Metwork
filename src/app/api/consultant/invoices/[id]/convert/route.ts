/**
 * POST /api/consultant/invoices/[id]/convert — body { paymentMethod, withStamp }
 * Turns a proforma or devis into a facture (see @/server/invoices/drafts).
 */
import type { NextRequest } from 'next/server';
import { jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { handleConvertDraft } from '@/server/invoices/draft-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleConvertDraft(req, guard.owner, id);
}
