/** GET /api/metworkcrm/search?q=… — grouped results across Organizations, Contacts, Tasks, Interactions. */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { globalSearch } from '@/server/metworkcrm/services/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const q = req.nextUrl.searchParams.get('q') ?? '';
  return json({ groups: await globalSearch(q) });
}
