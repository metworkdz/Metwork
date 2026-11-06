/** POST /api/academy/wishlist — { courseId, on }: add a published course to, or remove it from, my wishlist. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { setWishlisted } from '@/server/academy/wishlist';
import { ACADEMY_ID_RE, learnerError, parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ courseId: z.string().regex(ACADEMY_ID_RE), on: z.boolean() });

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const limited = await rateLimited(`academy:wishlist:${g.user.id}`, 60, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await setWishlisted(g.user.id, body.data.courseId, body.data.on);
  return res.ok ? json({ wishlisted: res.wishlisted }) : learnerError(res.code);
}
