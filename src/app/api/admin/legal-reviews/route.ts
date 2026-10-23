/**
 * GET /api/admin/legal-reviews?state=PENDING — business documents to review.
 * Admin only. Returns the extraction and reasons; the document itself is
 * opened through the signed-link route next to this one.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const raw = req.nextUrl.searchParams.get('state');
  const state = raw === 'APPROVED' || raw === 'REJECTED' ? raw : 'PENDING';
  const data = await db.read();
  const items = (data.freelancerProfiles ?? [])
    .filter((p) => p.legal?.review.state === state)
    .map((p) => {
      const u = data.users.find((x) => x.id === p.userId);
      return {
        userId: p.userId,
        fullName: u?.fullName ?? '',
        email: u?.email ?? '',
        status: p.legal!.status,
        documentKind: p.legal!.documentKind,
        submittedAt: p.legal!.submittedAt,
        extracted: p.legal!.extracted,
        review: p.legal!.review,
      };
    })
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return json({ items });
}
