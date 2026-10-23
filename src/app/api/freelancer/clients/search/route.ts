/**
 * GET /api/freelancer/clients/search?q=… — up to 10 of this freelancer's
 * clients matching the query. Feeds the client autocomplete on the invoice form.
 */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import { requireInvoicingFreelancer } from '@/server/invoices/freelancer-access';
import { searchClients } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;

  const items = await searchClients(guard.owner, req.nextUrl.searchParams.get('q') ?? '');
  return json({ items });
}
