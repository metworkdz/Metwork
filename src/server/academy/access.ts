/**
 * Who may watch which lesson — the ONE rule every Academy route calls
 * (playback token, heartbeat, lesson page). Pass access arrives in phase 3.
 *
 *   ADMIN    admins, any lesson (to review)
 *   OWNED    a lifetime enrollment (also for an archived course: buyers keep it)
 *   PREVIEW  a free preview lesson, any signed-in account
 *
 * Lessons in a "coming soon" module, or without a ready video, never play.
 */
import { db, type AcademyCourseRecord, type AcademyLessonRecord } from '@/server/db/store';
import { activeEnrollment } from './orders';

export type LessonAccess = 'ADMIN' | 'OWNED' | 'PREVIEW';

export type AccessResult =
  | { ok: true; access: LessonAccess; course: AcademyCourseRecord; lesson: AcademyLessonRecord }
  | { ok: false; code: 'NOT_FOUND' | 'LOCKED' | 'NOT_READY' };

export interface Viewer { id: string; role: string }

export function courseAccessFor(
  viewer: Viewer,
  course: AcademyCourseRecord,
  enrollments: Parameters<typeof activeEnrollment>[0],
): 'ADMIN' | 'OWNED' | null {
  if (viewer.role === 'ADMIN') return 'ADMIN';
  return activeEnrollment(enrollments, viewer.id, course.id) ? 'OWNED' : null;
}

export async function lessonAccess(viewer: Viewer, courseId: string, lessonId: string): Promise<AccessResult> {
  const d = await db.read();
  const course = d.academyCourses?.find((c) => c.id === courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  const courseAccess = courseAccessFor(viewer, course, d.academyEnrollments);
  // Drafts are for admins; archived courses stay open to their buyers only.
  if (course.status !== 'PUBLISHED' && courseAccess === null) return { ok: false, code: 'NOT_FOUND' };
  if (course.status !== 'PUBLISHED' && course.status !== 'ARCHIVED' && courseAccess !== 'ADMIN') return { ok: false, code: 'NOT_FOUND' };

  const mod = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
  const lesson = mod?.lessons.find((l) => l.id === lessonId);
  if (!mod || !lesson) return { ok: false, code: 'NOT_FOUND' };
  if (mod.comingSoon && courseAccess !== 'ADMIN') return { ok: false, code: 'NOT_READY' };

  const access: LessonAccess | null = courseAccess ?? (lesson.isPreview && !mod.comingSoon ? 'PREVIEW' : null);
  if (!access) return { ok: false, code: 'LOCKED' };
  if (lesson.videoStatus !== 'READY' || !lesson.videoId) return { ok: false, code: 'NOT_READY' };
  return { ok: true, access, course, lesson };
}

export interface OutlineLesson {
  id: string;
  title: string;
  durationSec: number;
  playable: boolean;
  isPreview: boolean;
  completed: boolean;
}
export interface OutlineModule { id: string; title: string; comingSoon: boolean; lessons: OutlineLesson[] }

/**
 * The course as this viewer sees it in the player sidebar: which lessons play
 * for them, and which they finished. Same rule as `lessonAccess`.
 */
export function buildOutline(
  viewer: Viewer,
  course: AcademyCourseRecord,
  enrollments: Parameters<typeof activeEnrollment>[0],
  completedLessonIds: Set<string>,
  resolve: (t: AcademyLessonRecord['title']) => string,
): { access: 'ADMIN' | 'OWNED' | null; modules: OutlineModule[] } {
  const access = courseAccessFor(viewer, course, enrollments);
  return {
    access,
    modules: course.modules.map((m) => ({
      id: m.id,
      title: resolve(m.title),
      comingSoon: m.comingSoon,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: resolve(l.title),
        durationSec: m.comingSoon ? 0 : l.durationSec,
        isPreview: l.isPreview && !m.comingSoon,
        playable: (access === 'ADMIN' || (!m.comingSoon && (access === 'OWNED' || l.isPreview))) && l.videoStatus === 'READY',
        completed: completedLessonIds.has(l.id),
      })),
    })),
  };
}
