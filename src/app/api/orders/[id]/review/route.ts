/** POST /api/orders/[id]/review — `{ rating 1–5, comment? }`: the founder reviews a completed order, once. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { reviewOrder } from '@/server/orders/service';
import { orderErrorResponse } from '@/server/orders/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).nullable().default(null) }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const r = await reviewOrder(guard.user.id, (await params).id, input.rating, input.comment);
  return r.ok ? json({ review: r.value.review }, { status: 201 }) : orderErrorResponse(r.reason);
}
