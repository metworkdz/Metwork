/** POST /api/academy/reminders — { off }: turn the "keep going" reminder emails off or back on. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { setRemindersOff } from '@/server/academy/wishlist';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const body = await parseBody(req, z.object({ off: z.boolean() }));
  if (!body.ok) return body.response;
  await setRemindersOff(g.user.id, body.data.off);
  return json({ off: body.data.off });
}
