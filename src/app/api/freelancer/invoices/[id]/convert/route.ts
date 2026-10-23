/**
 * POST /api/freelancer/invoices/[id]/convert — body { paymentMethod, withStamp }
 * Turns a proforma or devis into a facture (see @/server/invoices/drafts).
 */
import type { NextRequest } from 'next/server';
import { requireInvoicingFreelancer } from '@/server/invoices/freelancer-access';
import { handleConvertDraft } from '@/server/invoices/draft-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleConvertDraft(req, guard.owner, id);
}
