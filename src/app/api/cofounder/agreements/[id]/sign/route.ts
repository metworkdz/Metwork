/** POST /api/cofounder/agreements/[id]/sign — `{ signature: data:image/png…, code }`. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { agreementView, sign } from '@/server/cofounder/agreement';
import { agreementErrorResponse } from '@/server/cofounder/agreement-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The second signature renders and stores the PDF.
export const maxDuration = 60;

const schema = z.object({
  signature: z.string().max(400_000).regex(/^data:image\/png;base64,/),
  code: z.string().regex(/^\d{4,8}$/),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`cofounder-agreement-sign:${guard.user.id}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const r = await sign(guard.user.id, (await params).id, parsed.data.signature, parsed.data.code);
  return r.ok ? json({ agreement: agreementView(r.value, guard.user.id) }) : agreementErrorResponse(r.reason);
}
