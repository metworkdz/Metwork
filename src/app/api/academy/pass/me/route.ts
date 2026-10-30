/** GET /api/academy/pass/me — this visitor's Pass prices (Premium applied) and, if signed in, their Pass. */
import { json, jsonError } from '@/server/http/json';
import { readSession } from '@/server/auth/session';
import { isAcademyEnabled } from '@/config/feature-flags';
import { canBuyAcademy } from '@/lib/academy';
import { passStatusFor } from '@/server/academy/pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isAcademyEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const session = await readSession();
  const status = await passStatusFor(session?.user ?? null);
  return json({ signedIn: Boolean(session), canBuy: session ? canBuyAcademy(session.user.role) : true, ...status });
}
