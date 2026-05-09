/**
 * GET /api/incubator/clients/search?q=<query>
 *
 * Returns up to 10 clients matching the query (name, email, phone, company).
 * Used by the client autocomplete selector.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  if (!q || q.length < 1) return json({ items: [] });

  const data = await db.read();
  const results = (data.clients ?? [])
    .filter((c) => c.incubatorId === inc.id)
    .filter((c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.companyName ?? '').toLowerCase().includes(q),
    )
    .slice(0, 10);

  return json({ items: results });
}
