/**
 * GET  /api/messages — the caller's threads (inbox).
 * POST /api/messages — `{ toId, contextType, contextId, body }`: open a thread
 *      about an object (or continue the existing one) with a first message.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { CONTEXT_TYPES } from '@/server/messaging/repo';
import { inbox, MAX_BODY, startConversation } from '@/server/messaging/service';
import { messagingErrorResponse, withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startSchema = z.object({
  toId: z.string().min(1).max(80),
  contextType: z.enum(CONTEXT_TYPES),
  contextId: z.string().min(1).max(80).nullable(),
  body: z.string().trim().min(1).max(MAX_BODY),
}).strict();

export async function GET() {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  return withMessaging(async () => json({ threads: await inbox(guard.user.id) }));
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`msg-start:${guard.user.id}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many new conversations. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = startSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withMessaging(async () => {
    const r = await startConversation({ fromId: guard.user.id, ...input });
    return r.ok ? json(r.value, { status: 201 }) : messagingErrorResponse(r.reason, r.limit);
  });
}
