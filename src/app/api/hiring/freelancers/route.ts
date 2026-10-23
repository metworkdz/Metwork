/** GET /api/hiring/freelancers?q=&city=&maxPrice=&remote=1&verified=1&offset= — the directory, ranked. */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { db } from '@/server/db/store';
import { rankFreelancers } from '@/server/hiring/directory';
import { findCityCode } from '@/config/cities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 24;

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const maxPrice = Number(sp.get('maxPrice'));
  const offset = Math.max(0, Math.min(10_000, Number(sp.get('offset')) || 0));
  const ranked = rankFreelancers(await db.read(), null, {
    q: sp.get('q')?.slice(0, 100) ?? undefined,
    city: findCityCode(sp.get('city')) ?? undefined,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
    remote: sp.get('remote') === '1',
    verified: sp.get('verified') === '1',
  });
  return json({ total: ranked.length, freelancers: ranked.slice(offset, offset + PAGE).map((r) => r.card) });
}
