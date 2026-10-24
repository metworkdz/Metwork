/**
 * The caller's business-creation guide progress.
 *   GET    → { progress: { guide, done, updatedAt } | null }
 *   PUT    { guide, done } → { progress }   (unknown step ids are dropped)
 *   DELETE → 204, back to the chooser
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { db } from '@/server/db/store';
import { GUIDE_IDS, STEP_IDS } from '@/lib/creation-guides';
import { clearGuideProgress, guideProgressOf, saveGuideProgress } from '@/server/copilot/guides';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['FREELANCER', 'ENTREPRENEUR'] as const;

const bodySchema = z.object({
  guide: z.enum(GUIDE_IDS),
  done: z.array(z.enum(STEP_IDS)).max(STEP_IDS.length),
}).strict();

export async function GET() {
  const guard = await requireApiRole([...ROLES]);
  if (!guard.ok) return guard.response;
  return json({ progress: guideProgressOf(await db.read(), guard.user.id) });
}

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole([...ROLES]);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`guide:${guard.user.id}`, 60, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many updates. Wait a minute.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  try {
    const input = bodySchema.parse(body);
    return json({ progress: await saveGuideProgress(guard.user.id, input.guide, input.done) });
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
}

export async function DELETE() {
  const guard = await requireApiRole([...ROLES]);
  if (!guard.ok) return guard.response;
  await clearGuideProgress(guard.user.id);
  return noContent();
}
