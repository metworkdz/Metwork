/** POST /api/cofounder/swipe — `{ targetId, decision }` on a card of today's deck. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { swipe } from '@/server/cofounder/service';
import { withCofounder } from '@/server/cofounder/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ targetId: z.string().min(1).max(80), decision: z.enum(['LIKE', 'PASS']) }).strict();

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`cofounder-swipe:${guard.user.id}`, 60, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down a little.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withCofounder(async () => {
    const r = await swipe(guard.user.id, input.targetId, input.decision);
    if (r.ok) return json({ match: r.match });
    return r.reason === 'NOT_IN_DECK'
      ? jsonError(409, 'NOT_IN_DECK', 'This card is not in today’s deck')
      : jsonError(403, 'NOT_ALLOWED', 'Turn matching on first');
  });
}
