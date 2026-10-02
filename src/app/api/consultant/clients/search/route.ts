/**
 * GET /api/consultant/clients/search?q=… — up to 10 of this consultant's
 * clients matching the query. Feeds the client autocomplete on the invoice form.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { requireInvoicingConsultant } from '@/server/invoices/consultant-access';
import { searchClients } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireInvoicingConsultant();
  if (!guard.ok) return guard.response;

  const items = await searchClients(guard.owner, req.nextUrl.searchParams.get('q') ?? '');
  return json({ items });
}
