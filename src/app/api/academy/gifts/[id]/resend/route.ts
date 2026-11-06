/** POST /api/academy/gifts/{id}/resend — the buyer sends the claim link again (a new link; the old one stops working). */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { resendGiftLink } from '@/server/academy/gifts';
import { isAcademyId, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isAcademyId(id)) return jsonError(404, 'NOT_FOUND', 'Not found');
  const limited = await rateLimited(`academy:gift-resend:${g.user.id}`, 5, 60 * 60_000);
  if (limited) return limited;
  return (await resendGiftLink(g.user.id, id)) ? json({ ok: true }) : jsonError(409, 'NOT_RESENDABLE', 'This gift cannot be sent again');
}
