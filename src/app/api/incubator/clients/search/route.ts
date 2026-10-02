/**
 * GET /api/incubator/clients/search?q=<query>
 *
 * Returns up to 10 clients matching the query (name, email, phone, company).
 * Used by the client autocomplete selector.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { json, jsonError } from '@/server/http/json';
import { searchClients } from '@/server/invoices/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const items = await searchClients({ type: 'INCUBATOR', id: inc.id }, req.nextUrl.searchParams.get('q') ?? '');
  return json({ items });
}
