/**
 * GET  /api/admin/academy/moderation — recent reviews, questions and certificates (hidden included).
 * POST /api/admin/academy/moderation — { kind: 'REVIEW' | 'POST', id, hidden }: hide or show again.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json } from '@/server/http/json';
import { db } from '@/server/db/store';
import { listReviewsForManagers, setReviewHidden } from '@/server/academy/reviews';
import { questionInbox, setPostHidden } from '@/server/academy/qa';
import { learnerError, parseBody, requireAcademyAdmin } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const locale = req.nextUrl.searchParams.get('locale') ?? 'fr';
  const d = await db.read();
  const certificates = [...(d.academyCertificates ?? [])]
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 100)
    .map((c) => ({ id: c.id, number: c.number, fullName: c.fullName, courseTitle: c.courseTitle, issuedAt: c.issuedAt, revoked: Boolean(c.revokedAt) }));
  const [reviews, questions] = await Promise.all([
    listReviewsForManagers({ includeHidden: true, locale }),
    questionInbox('ALL', locale, { includeHidden: true }).catch(() => []),
  ]);
  return json({ reviews, questions, certificates });
}

const schema = z.object({ kind: z.enum(['REVIEW', 'POST']), id: z.string().min(1).max(64), hidden: z.boolean() });

export async function POST(req: NextRequest) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { kind, id, hidden } = body.data;
  const ok = kind === 'REVIEW' ? await setReviewHidden(id, g.admin.id, hidden) : await setPostHidden(id, g.admin.id, hidden);
  if (!ok) return learnerError('NOT_FOUND');
  void appendAuditLog({
    adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_CONTENT_MODERATED',
    targetType: kind === 'REVIEW' ? 'ACADEMY_REVIEW' : 'ACADEMY_POST', targetId: id, details: { hidden },
  });
  if (kind === 'REVIEW') revalidatePath('/[locale]/academy', 'layout');
  return json({ ok: true });
}
