/** POST /api/academy/pass/auto-renew — { autoRenew: false } cancels monthly renewal, true resumes it. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { setPassAutoRenew } from '@/server/academy/pass';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ autoRenew: z.boolean() });

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await setPassAutoRenew(g.user.id, body.data.autoRenew);
  if (!res.ok) return jsonError(409, res.code, res.code);
  return json(res);
}
