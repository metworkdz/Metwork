/** POST /api/messages/[id]/report — `{ reason, note? }`: report a thread to the admins. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { MESSAGE_REPORT_REASONS } from '@/server/db/store';
import { reportConversation } from '@/server/messaging/service';
import { withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  reason: z.enum(MESSAGE_REPORT_REASONS),
  note: z.string().trim().max(1000).nullable().default(null),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'NOT_FOUND', 'Conversation not found');
  if (!(await checkRateLimitDistributed(`msg-report:${guard.user.id}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many reports. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withMessaging(async () =>
    (await reportConversation({ userId: guard.user.id, conversationId: id, reason: input.reason, note: input.note || null }))
      ? json({ ok: true }, { status: 201 })
      : jsonError(404, 'NOT_FOUND', 'Conversation not found'),
  );
}
