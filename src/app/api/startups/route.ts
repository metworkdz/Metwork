/**
 * GET  /api/startups  — authenticated; lists ACTIVE listings (all users)
 *                       or all own listings when ?mine=true (founder only).
 * POST /api/startups  — authenticated ENTREPRENEURs with a membership code.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { createStartupSchema } from '@/server/startups/schemas';
import { createStartup, listStartups } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const mine = req.nextUrl.searchParams.get('mine') === 'true';

  const listings = await listStartups(
    mine
      ? { founderId: guard.user.id }
      : { status: 'ACTIVE' },
  );

  return json({ items: listings.map(toStartupDto), total: listings.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  // Only entrepreneurs with an active membership can list a startup.
  if (guard.user.role !== 'ENTREPRENEUR') {
    return jsonError(403, 'FORBIDDEN', 'Only entrepreneurs can create startup listings');
  }
  if (!guard.user.membershipCode) {
    return jsonError(403, 'MEMBERSHIP_REQUIRED', 'An active startup membership is required');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = createStartupSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const listing = await createStartup(input, guard.user.id);
  return json(toStartupDto(listing), { status: 201 });
}
