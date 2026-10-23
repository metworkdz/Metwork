/**
 * GET   /api/messages/[id]?after=&before= — messages of one thread (marks it read).
 * POST  /api/messages/[id] — `{ body, attachment? }`: reply.
 * PATCH /api/messages/[id] — `{ muted? , blocked? }`.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { MAX_BODY, sendMessage, setBlocked, setMuted, thread } from '@/server/messaging/service';
import { messagingErrorResponse, withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true }).optional();

const sendSchema = z.object({
  body: z.string().max(MAX_BODY).default(''),
  attachment: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('INVOICE'), invoiceId: z.string().min(1).max(80) }).strict(),
    z.object({ kind: z.literal('PAYMENT_LINK'), linkId: z.string().min(1).max(80) }).strict(),
  ]).nullable().default(null),
}).strict();

const patchSchema = z.object({ muted: z.boolean().optional(), blocked: z.boolean().optional() }).strict();

async function readJson(req: NextRequest): Promise<unknown | Response> {
  try { return await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const id = (await params).id;
  const sp = req.nextUrl.searchParams;
  const parsed = z.object({ id: uuid, after: iso, before: iso }).safeParse({
    id, after: sp.get('after') ?? undefined, before: sp.get('before') ?? undefined,
  });
  if (!parsed.success) return jsonError(404, 'NOT_FOUND', 'Conversation not found');
  return withMessaging(async () => {
    const t = await thread(guard.user.id, id, { after: parsed.data.after, before: parsed.data.before });
    return t ? json(t) : jsonError(404, 'NOT_FOUND', 'Conversation not found');
  });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const id = (await params).id;
  if (!uuid.safeParse(id).success) return jsonError(404, 'NOT_FOUND', 'Conversation not found');
  if (!(await checkRateLimitDistributed(`msg-send:${guard.user.id}`, 30, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many messages. Slow down a little.');
  }
  const body = await readJson(req);
  if (body instanceof Response) return body;
  let input;
  try { input = sendSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withMessaging(async () => {
    const r = await sendMessage({ userId: guard.user.id, conversationId: id, ...input });
    return r.ok ? json(r.value, { status: 201 }) : messagingErrorResponse(r.reason);
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const id = (await params).id;
  if (!uuid.safeParse(id).success) return jsonError(404, 'NOT_FOUND', 'Conversation not found');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withMessaging(async () => {
    if (input.muted !== undefined && !(await setMuted(guard.user.id, id, input.muted))) return jsonError(404, 'NOT_FOUND', 'Conversation not found');
    if (input.blocked !== undefined && !(await setBlocked(guard.user.id, id, input.blocked))) return jsonError(404, 'NOT_FOUND', 'Conversation not found');
    return json({ ok: true });
  });
}
