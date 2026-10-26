/** POST /api/admin/academy/courses/{id}/status — { change: 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE' } */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { json, jsonError } from '@/server/http/json';
import { redactCourseForBuilder, setCourseStatus } from '@/server/academy/catalog';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ change: z.enum(['PUBLISH', 'UNPUBLISH', 'ARCHIVE']) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await setCourseStatus(id, body.data.change);
  if (!res.ok) {
    if (res.code === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Course not found');
    return jsonError(422, 'NOT_READY', 'Course is not ready to publish', { problems: res.problems });
  }
  void appendAuditLog({
    adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_COURSE_STATUS_CHANGED',
    targetType: 'ACADEMY_COURSE', targetId: id, details: { change: body.data.change, slug: res.course.slug },
  });
  // The catalogue pages are ISR: show the change now rather than within the minute.
  revalidatePath('/[locale]/academy', 'layout');
  return json({ course: redactCourseForBuilder(res.course) });
}
