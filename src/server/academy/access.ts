/**
 * Who may watch which lesson — the ONE rule every Academy route calls
 * (playback token, heartbeat, lesson page).  *
 *   ADMIN    admins, any lesson (to review)
 *   OWNED    a lifetime enrollment (also for an archived course: buyers keep it)
 *   PASS     an active Academy Pass, for PUBLISHED courses marked "in the Pass"
 *            (an archived course leaves the Pass: owner decision 9)
 *   PREVIEW  a free preview lesson, any signed-in account
 * An owner watching their own course counts as OWNED, never as Pass time.
 *
 * Lessons in a "coming soon" module, or without a ready video, never play.
 */
import { db, type AcademyCourseRecord, type AcademyLessonRecord } from '@/server/db/store';
import { activeEnrollment } from './orders';
import { activePass } from './pass-core';

export type LessonAccess = 'ADMIN' | 'OWNED' | 'PASS' | 'PREVIEW';

export type AccessResult =
  | { ok: true; access: LessonAccess; course: AcademyCourseRecord; lesson: AcademyLessonRecord }
  | { ok: false; code: 'NOT_FOUND' | 'LOCKED' | 'NOT_READY' };

export interface Viewer { id: string; role: string }

type PassDoc = Parameters<typeof activePass>[0];

export function courseAccessFor(
  viewer: Viewer,
  course: AcademyCourseRecord,
  enrollments: Parameters<typeof activeEnrollment>[0],
  passes?: PassDoc,
): 'ADMIN' | 'OWNED' | 'PASS' | null {
  if (viewer.role === 'ADMIN') return 'ADMIN';
  if (activeEnrollment(enrollments, viewer.id, course.id)) return 'OWNED';
  if (passes && course.status === 'PUBLISHED' && course.includedInPass && activePass(passes, viewer.id)) return 'PASS';
  return null;
}

export async function lessonAccess(viewer: Viewer, courseId: string, lessonId: string): Promise<AccessResult> {
  const d = await db.read();
  const course = d.academyCourses?.find((c) => c.id === courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  const courseAccess = courseAccessFor(viewer, course, d.academyEnrollments, d);
  // Drafts are for admins; archived courses stay open to their buyers only.
  if (course.status !== 'PUBLISHED' && (courseAccess === null || courseAccess === 'PASS')) return { ok: false, code: 'NOT_FOUND' };
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
  passes?: PassDoc,
): { access: 'ADMIN' | 'OWNED' | 'PASS' | null; modules: OutlineModule[] } {
  const access = courseAccessFor(viewer, course, enrollments, passes);
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
        playable: (access === 'ADMIN' || (!m.comingSoon && (access === 'OWNED' || access === 'PASS' || l.isPreview))) && l.videoStatus === 'READY',
        completed: completedLessonIds.has(l.id),
      })),
    })),
  };
}
