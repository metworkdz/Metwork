/** POST /api/admin/academy/courses/{id}/lessons/{lessonId}/subtitles/translate — draft the other languages. */
import type { NextRequest } from 'next/server';
import { requireAcademyAdmin } from '@/server/academy/http';
import { subtitleTranslate } from '@/server/academy/subtitle-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  return subtitleTranslate(id, lessonId, `admin:${g.admin.id}`);
}
