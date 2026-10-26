/**
 * GET    /api/admin/academy/courses/{id} — the builder state (no video ids) + what blocks publishing
 * PUT    /api/admin/academy/courses/{id} — save the whole builder state
 * DELETE /api/admin/academy/courses/{id} — only while nobody has bought it
 */
import type { NextRequest } from 'next/server';
import { json, jsonError, noContent } from '@/server/http/json';
import {
  courseDraftSchema,
  deleteCourse,
  getCourseForAdmin,
  publishProblems,
  redactCourseForBuilder,
  saveCourseDraft,
} from '@/server/academy/catalog';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const course = await getCourseForAdmin(id);
  if (!course) return jsonError(404, 'NOT_FOUND', 'Course not found');
  return json({ course: redactCourseForBuilder(course), problems: await publishProblems(course) });
}

const STATUS: Record<string, number> = { NOT_FOUND: 404, SLUG_TAKEN: 409 };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, courseDraftSchema);
  if (!body.ok) return body.response;
  const res = await saveCourseDraft(id, body.data);
  if (!res.ok) return jsonError(STATUS[res.code] ?? 422, res.code, res.code);
  return json({ course: redactCourseForBuilder(res.value), problems: await publishProblems(res.value) });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const res = await deleteCourse(id);
  if (!res.ok) return jsonError(res.code === 'NOT_FOUND' ? 404 : 409, res.code, res.code);
  void appendAuditLog({ adminId: g.admin.id, adminEmail: g.admin.email, action: 'ACADEMY_COURSE_DELETED', targetType: 'ACADEMY_COURSE', targetId: id });
  return noContent();
}
