/**
 * GET /api/academy/courses/{slug}/me — what this visitor sees on the buy card:
 * signed in or not, owns it or not, and their own price. Keeps the course page
 * itself cacheable.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { readSession } from '@/server/auth/session';
import { isAcademyEnabled } from '@/config/feature-flags';
import { canBuyAcademy } from '@/lib/academy';
import { quoteForBuyer } from '@/server/academy/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAcademyEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const { slug } = await params;
  const session = await readSession();
  const q = await quoteForBuyer(session?.user ?? null, slug);
  if (!q.ok) return jsonError(404, q.code, 'Course not found');
  return json({
    signedIn: Boolean(session),
    canBuy: session ? canBuyAcademy(session.user.role) : true,
    owned: q.owned || session?.user.role === 'ADMIN',
    premium: q.premium,
    quote: q.quote,
  });
}
