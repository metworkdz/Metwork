/** POST /api/academy/gifts/claim — { token }: claim a gift on the signed-in account. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json, jsonError } from '@/server/http/json';
import { claimGift, GIFT_TOKEN_RE } from '@/server/academy/gifts';
import { parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { NOT_FOUND: 404, EXPIRED: 410, ALREADY_CLAIMED: 409, ALREADY_OWNED: 409 };

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  // Tokens are unguessable, but a budget keeps anyone from trying.
  const limited = await rateLimited(`academy:gift-claim:${g.user.id}`, 10, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, z.object({ token: z.string().regex(GIFT_TOKEN_RE) }));
  if (!body.ok) return body.response;
  const res = await claimGift(body.data.token, g.user.id);
  if (!res.ok) return jsonError(STATUS[res.code] ?? 422, res.code, res.code);
  revalidatePath('/[locale]/academy/my', 'page');
  return json(res);
}
