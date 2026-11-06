/** GET / POST / DELETE /api/admin/academy/courses/{id}/lessons/{lessonId}/subtitles — see server/academy/subtitle-routes. */
import type { NextRequest } from 'next/server';
import { requireAcademyAdmin } from '@/server/academy/http';
import { subtitleDelete, subtitleGet, subtitlePost } from '@/server/academy/subtitle-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; lessonId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  return subtitleGet(req, id, lessonId);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  return subtitlePost(req, id, lessonId, `admin:${g.admin.id}`);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  return subtitleDelete(req, id, lessonId);
}
