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
import { isLiveModule, isVisibleModule } from '@/lib/academy';

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

type StoreData = Awaited<ReturnType<typeof db.read>>;

export type CourseAccessResult =
  | { ok: true; access: 'ADMIN' | 'OWNED' | 'PASS' | null; course: AcademyCourseRecord; d: StoreData }
  | { ok: false; code: 'NOT_FOUND' };

/**
 * The course as this viewer may reach it at all. `access` null = a published
 * course they have not bought (previews only). Drafts are for admins;
 * archived courses stay open to their buyers only.
 */
export async function courseReach(viewer: Viewer, courseId: string): Promise<CourseAccessResult> {
  const d = await db.read();
  const course = d.academyCourses?.find((c) => c.id === courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  const courseAccess = courseAccessFor(viewer, course, d.academyEnrollments, d);
  if (course.status !== 'PUBLISHED' && (courseAccess === null || courseAccess === 'PASS')) return { ok: false, code: 'NOT_FOUND' };
  if (course.status !== 'PUBLISHED' && course.status !== 'ARCHIVED' && courseAccess !== 'ADMIN') return { ok: false, code: 'NOT_FOUND' };
  return { ok: true, access: courseAccess, course, d };
}

export async function lessonAccess(viewer: Viewer, courseId: string, lessonId: string): Promise<AccessResult> {
  const reach = await courseReach(viewer, courseId);
  if (!reach.ok) return reach;
  const { course, access: courseAccess } = reach;

  const mod = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
  const lesson = mod?.lessons.find((l) => l.id === lessonId);
  if (!mod || !lesson) return { ok: false, code: 'NOT_FOUND' };
  if (!isLiveModule(mod) && courseAccess !== 'ADMIN') return { ok: false, code: 'NOT_READY' };

  const access: LessonAccess | null = courseAccess ?? (lesson.isPreview && isLiveModule(mod) ? 'PREVIEW' : null);
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
export interface OutlineModule {
  id: string;
  title: string;
  comingSoon: boolean;
  lessons: OutlineLesson[];
  /** End-of-module quiz of a released module; `passed` is filled by the learn view. */
  quiz: { questions: number; passed: boolean } | null;
}

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
    // A module awaiting approval exists only for admins.
    modules: course.modules.filter((m) => access === 'ADMIN' || isVisibleModule(m)).map((m) => ({
      id: m.id,
      title: resolve(m.title),
      comingSoon: m.comingSoon,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: resolve(l.title),
        durationSec: isLiveModule(m) ? l.durationSec : 0,
        isPreview: l.isPreview && isLiveModule(m),
        playable: (access === 'ADMIN' || (isLiveModule(m) && (access === 'OWNED' || access === 'PASS' || l.isPreview))) && l.videoStatus === 'READY',
        completed: completedLessonIds.has(l.id),
      })),
      quiz: (m.quiz?.questions.length ?? 0) > 0 && (isLiveModule(m) || access === 'ADMIN') ? { questions: m.quiz!.questions.length, passed: false } : null,
    })),
  };
}
