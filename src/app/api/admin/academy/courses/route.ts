/**
 * GET  /api/admin/academy/courses — every course, newest edit first
 * POST /api/admin/academy/courses — open a draft { title, fieldId, mentorIds }
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { createCourse, createCourseSchema, listCoursesForAdmin, redactCourseForBuilder } from '@/server/academy/catalog';
import { parseBody, requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const items = (await listCoursesForAdmin()).map(redactCourseForBuilder);
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const body = await parseBody(req, createCourseSchema);
  if (!body.ok) return body.response;
  const res = await createCourse(body.data, { kind: 'ADMIN', id: g.admin.id });
  if (!res.ok) return jsonError(422, res.code, res.code);
  return json(redactCourseForBuilder(res.value), { status: 201 });
}
