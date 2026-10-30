/** Data for the learn pages: the course a viewer may open, its outline and their progress. */
import { db, type AcademyCourseRecord } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { academyRepo } from './repo';
import { buildOutline, courseAccessFor, type OutlineModule, type Viewer } from './access';

export interface LearnView {
  course: AcademyCourseRecord;
  title: string;
  access: 'ADMIN' | 'OWNED' | null;
  modules: OutlineModule[];
  completedCount: number;
  playableCount: number;
  /** Where to send someone opening /academy/learn/{slug}: first unfinished lesson they can play. */
  resumeLessonId: string | null;
}

export async function getLearnView(viewer: Viewer, slug: string, locale: string): Promise<LearnView | null> {
  const d = await db.read();
  const course = (d.academyCourses ?? []).find((c) => c.slug === slug);
  if (!course) return null;
  const access = courseAccessFor(viewer, course, d.academyEnrollments);
  // Published for everyone (previews); archived only for its buyers; drafts for admins.
  if (course.status !== 'PUBLISHED' && !(course.status === 'ARCHIVED' && access) && access !== 'ADMIN') return null;

  const progress = await academyRepo().progressFor(viewer.id, course.id);
  const done = new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId));
  const outline = buildOutline(viewer, course, d.academyEnrollments, done, (t) => resolveText(t, locale));
  const playable = outline.modules.flatMap((m) => m.lessons).filter((l) => l.playable);
  const resume = playable.find((l) => !l.completed) ?? playable[0] ?? null;
  return {
    course,
    title: resolveText(course.title, locale),
    access: outline.access,
    modules: outline.modules,
    completedCount: playable.filter((l) => l.completed).length,
    playableCount: playable.length,
    resumeLessonId: resume?.id ?? null,
  };
}
