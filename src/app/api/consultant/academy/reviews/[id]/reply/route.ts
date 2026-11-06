/** POST /api/consultant/academy/reviews/{id}/reply — { text }: the mentor's one public reply to a review. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json } from '@/server/http/json';
import { replyToReview, REVIEW_REPLY_MAX } from '@/server/academy/reviews';
import { learnerError, parseBody, rateLimited, requireStudioMentor } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const limited = await rateLimited(`academy:review-reply:${g.mentorId}`, 30, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, z.object({ text: z.string().trim().min(1).max(REVIEW_REPLY_MAX) }));
  if (!body.ok) return body.response;
  const res = await replyToReview(g.mentorId, id, body.data.text);
  if (!res.ok) return learnerError(res.code);
  revalidatePath('/[locale]/academy', 'layout');
  return json({ ok: true });
}
