/**
 * POST /api/admin/academy/courses/{id}/review — answer a mentor submission:
 *   { action: 'REQUEST_CHANGES', note } | { action: 'APPROVE_MODULES' } | { action: 'REJECT_MODULES', note }
 * Publishing a submitted course is the regular status change (PUBLISH).
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json } from '@/server/http/json';
import { publishProblems, redactCourseForBuilder } from '@/server/academy/catalog';
import { reviewCourse } from '@/server/academy/studio';
import { parseBody, requireAcademyAdmin, studioError } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('REQUEST_CHANGES'), note: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal('APPROVE_MODULES') }),
  z.object({ action: z.literal('REJECT_MODULES'), note: z.string().trim().min(3).max(2000) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await reviewCourse(id, body.data);
  if (!res.ok) return studioError(res.code, res.problems);
  void appendAuditLog({
    adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_COURSE_STATUS_CHANGED',
    targetType: 'ACADEMY_COURSE', targetId: id, details: { review: body.data.action },
  });
  if (body.data.action === 'APPROVE_MODULES') revalidatePath('/[locale]/academy', 'layout');
  return json({ course: redactCourseForBuilder(res.value), problems: await publishProblems(res.value) });
}
