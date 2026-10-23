/**
 * GET /api/admin/legal-reviews/[userId]/document — redirect to a 5-minute
 * signed link for the stored document. Admin only, and every view is written
 * to the audit log: these are identity documents.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { signedRawDownloadUrl } from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams { params: Promise<{ userId: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const data = await db.read();
  const legal = data.freelancerProfiles?.find((p) => p.userId === userId)?.legal;
  if (!legal) return jsonError(404, 'NOT_FOUND', 'No document for this user');
  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'LEGAL_DOCUMENT_VIEWED',
    targetType: 'user',
    targetId: userId,
  });
  const res = NextResponse.redirect(signedRawDownloadUrl(legal.documentPublicId));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
