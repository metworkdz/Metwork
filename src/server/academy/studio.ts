/**
 * Mentor Studio — mentors building their own courses, and the admin review
 * of what they submit. Every write goes through the catalogue service
 * (`saveCourseDraft`, `setCourseStatus`, `deleteCourse`), so the rules that
 * protect videos and validate courses are the same for admins and mentors.
 *
 * Owner decisions:
 *  - Nothing a mentor makes goes live without admin approval.
 *  - Submitting needs a SIGNED Academy addendum.
 *  - A mentor owns the courses THEY created. A course the admin created and
 *    attached them to (Module 1, for example) is visible but read-only for them.
 *  - On a PUBLISHED course the mentor may only add modules; each stays hidden
 *    from learners until the admin approves it. Every other change goes through
 *    the admin.
 */
import { db, type AcademyCourseRecord } from '@/server/db/store';
import { algiersDay } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { createNotification } from '@/server/notifications/create-notification';
import {
  createCourse,
  deleteCourse,
  publishProblems,
  redactCourseForBuilder,
  saveCourseDraft,
  type CatalogError,
  type CourseDraftInput,
  type CreateCourseInput,
  type PublishProblem,
} from './catalog';
import { createLessonUpload, refreshLessonVideo, type UploadForm } from './videos';
import { getAddendumState, type AddendumState } from './addendum';
import { academyRepo } from './repo';

/** The mentor created it (not merely attached to it by the admin). */
export function ownsCourse(course: Pick<AcademyCourseRecord, 'createdBy'>, mentorId: string): boolean {
  return course.createdBy.kind === 'MENTOR' && course.createdBy.id === mentorId;
}

/** What the mentor may do with the course right now. */
export type EditMode = 'FULL' | 'ADD_MODULES' | 'LOCKED' | 'READ_ONLY';

export function editModeFor(course: AcademyCourseRecord, mentorId: string): EditMode {
  if (!ownsCourse(course, mentorId)) return 'READ_ONLY';
  if (course.status === 'DRAFT' || course.status === 'CHANGES_REQUESTED') return 'FULL';
  if (course.status === 'PUBLISHED') return 'ADD_MODULES';
  return 'LOCKED';
}

async function ownedCourse(mentorId: string, courseId: string) {
  const course = (await db.read()).academyCourses?.find((c) => c.id === courseId);
  if (!course || !course.mentorIds.includes(mentorId)) return null;
  return course;
}

/* ─────────────────────────── Reads ─────────────────────────── */

export interface StudioCourseStats { buyers: number; earnedDzd: number }

export interface StudioOverview {
  addendum: AddendumState;
  courses: (ReturnType<typeof redactCourseForBuilder> & { editMode: EditMode; stats: StudioCourseStats })[];
  totals: { buyers: number; passMinutesThisMonth: number; earnedDzd: number };
}

export async function getStudioOverview(mentorId: string, now = new Date()): Promise<StudioOverview> {
  const d = await db.read();
  const mine = (d.academyCourses ?? []).filter((c) => c.mentorIds.includes(mentorId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const ledger = (d.mentorLedgerTxns ?? []).filter((t) => t.mentorId === mentorId && t.type === 'EARNING' && t.status !== 'REVERSED');

  // Pass watch time is counted per mentor (not per course): one figure for the Studio.
  let passMinutesThisMonth = 0;
  try {
    const totals = await academyRepo().watchTotals(`${now.toISOString().slice(0, 7)}-01`, algiersDay(now), 'PASS');
    passMinutesThisMonth = Math.round(totals.filter((t) => t.mentorId === mentorId).reduce((s, t) => s + t.seconds, 0) / 60);
  } catch { /* storage unavailable: show 0 */ }

  const courses = mine.map((c) => {
    const enrollments = (d.academyEnrollments ?? []).filter((e) => e.courseId === c.id && !e.refundedAt && !e.revokedAt);
    const earnedDzd = ledger
      .filter((t) => enrollments.some((e) => t.bookingId === `academy-${e.id}`))
      .reduce((s, t) => s + t.amount, 0);
    return {
      ...redactCourseForBuilder(c),
      editMode: editModeFor(c, mentorId),
      stats: { buyers: enrollments.length, earnedDzd },
    };
  });
  const allEarned = ledger.filter((t) => (t.bookingId ?? '').startsWith('academy-')).reduce((s, t) => s + t.amount, 0);
  return {
    addendum: (await getAddendumState(mentorId)).state,
    courses,
    totals: {
      buyers: courses.reduce((s, c) => s + c.stats.buyers, 0),
      passMinutesThisMonth,
      earnedDzd: allEarned,
    },
  };
}

export async function getStudioCourse(mentorId: string, courseId: string) {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return null;
  return { course: redactCourseForBuilder(course), editMode: editModeFor(course, mentorId), problems: await publishProblems(course) };
}

/* ─────────────────────────── Writes ─────────────────────────── */

export type StudioError = CatalogError | 'LOCKED' | 'READ_ONLY' | 'ADDENDUM_REQUIRED' | 'NOT_READY' | 'NOTHING_TO_SUBMIT';
export type StudioResult<T> = { ok: true; value: T } | { ok: false; code: StudioError; problems?: PublishProblem[] };

export async function createMentorCourse(mentorId: string, input: Omit<CreateCourseInput, 'mentorIds'>): Promise<StudioResult<AcademyCourseRecord>> {
  const res = await createCourse({ ...input, mentorIds: [mentorId] }, { kind: 'MENTOR', id: mentorId });
  return res.ok ? res : { ok: false, code: res.code };
}

/** A course as builder input, for the parts a mentor may not change. */
function asDraftInput(c: AcademyCourseRecord): CourseDraftInput {
  return {
    slug: c.slug,
    fieldId: c.fieldId,
    mentorIds: c.mentorIds,
    title: c.title,
    subtitle: c.subtitle,
    description: c.description,
    outcomes: c.outcomes,
    level: c.level,
    audioLanguage: c.audioLanguage,
    priceDzd: c.priceDzd,
    includedInPass: c.includedInPass,
    thumbnailUrl: c.thumbnailUrl,
    modules: c.modules.map((m) => ({
      id: m.id,
      title: m.title,
      comingSoon: m.comingSoon,
      lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, description: l.description, isPreview: l.isPreview })),
      quiz: m.quiz ? { questions: m.quiz.questions.map((q) => ({ ...q })) } : null,
    })),
  };
}

export async function saveMentorCourse(mentorId: string, courseId: string, input: CourseDraftInput): Promise<StudioResult<AcademyCourseRecord>> {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  const mode = editModeFor(course, mentorId);
  if (mode === 'READ_ONLY') return { ok: false, code: 'READ_ONLY' };
  if (mode === 'LOCKED') return { ok: false, code: 'LOCKED' };

  let draft: CourseDraftInput;
  if (mode === 'FULL') {
    // The mentor cannot change who teaches it, its address or whether it is in the Pass.
    draft = { ...input, mentorIds: course.mentorIds, slug: course.slug, includedInPass: course.includedInPass };
  } else {
    // Published: the live course stays exactly as approved; only the mentor's
    // own new / pending modules come from the request.
    const stored = asDraftInput(course);
    const approvedIds = new Set(course.modules.filter((m) => !m.pendingReview).map((m) => m.id));
    const approved = stored.modules.filter((m) => approvedIds.has(m.id!));
    const proposed = input.modules.filter((m) => !m.id || !approvedIds.has(m.id));
    draft = { ...stored, modules: [...approved, ...proposed] };
  }
  const res = await saveCourseDraft(courseId, draft, { newModulesPendingReview: mode === 'ADD_MODULES' });
  return res.ok ? res : { ok: false, code: res.code };
}

/**
 * May the mentor change this lesson's files (video, subtitles) now? Their own
 * draft, or a module of theirs still awaiting approval on a live course.
 */
export async function mentorCanEditLesson(mentorId: string, courseId: string, lessonId: string): Promise<boolean> {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return false;
  const mode = editModeFor(course, mentorId);
  const mod = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
  return Boolean(mod) && (mode === 'FULL' || (mode === 'ADD_MODULES' && Boolean(mod!.pendingReview)));
}

/** Upload a lesson video — only for lessons the mentor may edit now. */
export async function mentorLessonUpload(mentorId: string, courseId: string, lessonId: string): Promise<StudioResult<UploadForm>> {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  const mode = editModeFor(course, mentorId);
  if (mode === 'READ_ONLY') return { ok: false, code: 'READ_ONLY' };
  const mod = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
  if (!mod) return { ok: false, code: 'NOT_FOUND' };
  // A live lesson's video cannot be swapped by the mentor: that would change an approved course.
  if (mode === 'LOCKED' || (mode === 'ADD_MODULES' && !mod.pendingReview)) return { ok: false, code: 'LOCKED' };
  const res = await createLessonUpload(courseId, lessonId);
  return res.ok ? res : { ok: false, code: 'NOT_FOUND' };
}

export async function mentorLessonRefresh(mentorId: string, courseId: string, lessonId: string) {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return { ok: false as const, code: 'NOT_FOUND' as const };
  return refreshLessonVideo(courseId, lessonId);
}

async function notifyAdmins(title: string, body: string, courseId: string) {
  const admins = (await db.read()).users.filter((u) => u.role === 'ADMIN');
  for (const a of admins) {
    await createNotification({ userId: a.id, type: 'GENERAL', title, body, href: `/dashboard/admin/academy/courses/${courseId}` });
  }
}

/**
 * Send to review: a whole draft course, or the new modules of a published one.
 * Needs the signed addendum and a course that would pass the publish checks.
 */
export async function submitMentorCourse(mentorId: string, courseId: string): Promise<StudioResult<AcademyCourseRecord>> {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  const mode = editModeFor(course, mentorId);
  if (mode === 'READ_ONLY') return { ok: false, code: 'READ_ONLY' };
  if (mode === 'LOCKED') return { ok: false, code: 'LOCKED' };
  if ((await getAddendumState(mentorId)).state !== 'SIGNED') return { ok: false, code: 'ADDENDUM_REQUIRED' };

  const mentor = (await db.read()).mentors.find((m) => m.id === mentorId);
  const title = resolveText(course.title, 'fr');

  if (mode === 'FULL') {
    // Mentor approval is the admin's to check; everything else must be in place.
    const problems = (await publishProblems(course)).filter((p) => p !== 'MENTOR_NOT_APPROVED');
    if (problems.length) return { ok: false, code: 'NOT_READY', problems };
    const updated = await db.update((d) => {
      const c = d.academyCourses?.find((x) => x.id === courseId);
      if (!c || (c.status !== 'DRAFT' && c.status !== 'CHANGES_REQUESTED')) return null;
      c.status = 'IN_REVIEW';
      c.submittedAt = new Date().toISOString();
      c.updatedAt = c.submittedAt;
      return c;
    });
    if (!updated) return { ok: false, code: 'LOCKED' };
    await notifyAdmins('Nouveau cours à examiner', `${mentor?.fullName ?? 'Un mentor'} a envoyé « ${title} ».`, courseId);
    return { ok: true, value: updated };
  }

  // ADD_MODULES: every pending module needs lessons with ready videos.
  const pending = course.modules.filter((m) => m.pendingReview);
  if (!pending.length) return { ok: false, code: 'NOTHING_TO_SUBMIT' };
  if (pending.some((m) => !m.lessons.length || m.lessons.some((l) => l.videoStatus !== 'READY'))) {
    return { ok: false, code: 'NOT_READY', problems: ['VIDEO_NOT_READY'] };
  }
  const updated = await db.update((d) => {
    const c = d.academyCourses?.find((x) => x.id === courseId);
    if (!c) return null;
    c.modulesSubmittedAt = new Date().toISOString();
    c.reviewNote = null;
    return c;
  });
  if (!updated) return { ok: false, code: 'NOT_FOUND' };
  await notifyAdmins('Nouveaux modules à examiner', `${mentor?.fullName ?? 'Un mentor'} propose ${pending.length} module(s) pour « ${title} ».`, courseId);
  return { ok: true, value: updated };
}

/** Delete a draft the mentor never sent to review. */
export async function deleteMentorCourse(mentorId: string, courseId: string): Promise<StudioResult<null>> {
  const course = await ownedCourse(mentorId, courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  if (!ownsCourse(course, mentorId)) return { ok: false, code: 'READ_ONLY' };
  if (course.status !== 'DRAFT' || course.submittedAt) return { ok: false, code: 'LOCKED' };
  const res = await deleteCourse(courseId);
  return res.ok ? res : { ok: false, code: res.code };
}

/* ─────────────────────────── Admin review ─────────────────────────── */

export interface ReviewItem { courseId: string; title: string; mentorName: string; kind: 'COURSE' | 'MODULES'; submittedAt: string; pendingModules: number }

/** Mentor submissions waiting for the admin, oldest first. */
export async function listReviewQueue(locale: string): Promise<ReviewItem[]> {
  const d = await db.read();
  const items: ReviewItem[] = [];
  for (const c of d.academyCourses ?? []) {
    const mentorName = d.mentors.find((m) => m.id === c.mentorIds[0])?.fullName ?? '?';
    if (c.status === 'IN_REVIEW' && c.submittedAt) {
      items.push({ courseId: c.id, title: resolveText(c.title, locale), mentorName, kind: 'COURSE', submittedAt: c.submittedAt, pendingModules: 0 });
    } else if (c.status === 'PUBLISHED' && c.modulesSubmittedAt) {
      items.push({ courseId: c.id, title: resolveText(c.title, locale), mentorName, kind: 'MODULES', submittedAt: c.modulesSubmittedAt, pendingModules: c.modules.filter((m) => m.pendingReview).length });
    }
  }
  return items.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export type ReviewAction =
  | { action: 'REQUEST_CHANGES'; note: string }
  | { action: 'APPROVE_MODULES' }
  | { action: 'REJECT_MODULES'; note: string };

/**
 * Admin answers a submission. Publishing a submitted course is the existing
 * PUBLISH status change (it re-runs every check); this handles the rest.
 */
export async function reviewCourse(courseId: string, review: ReviewAction): Promise<StudioResult<AcademyCourseRecord>> {
  const course = (await db.read()).academyCourses?.find((c) => c.id === courseId);
  if (!course) return { ok: false, code: 'NOT_FOUND' };
  if (review.action === 'APPROVE_MODULES') {
    const pending = course.modules.filter((m) => m.pendingReview);
    if (!pending.length) return { ok: false, code: 'NOTHING_TO_SUBMIT' };
    if (pending.some((m) => m.lessons.some((l) => l.videoStatus !== 'READY'))) return { ok: false, code: 'NOT_READY', problems: ['VIDEO_NOT_READY'] };
  }
  if (review.action === 'REQUEST_CHANGES' && course.status !== 'IN_REVIEW') return { ok: false, code: 'LOCKED' };

  const updated = await db.update((d) => {
    const c = d.academyCourses?.find((x) => x.id === courseId);
    if (!c) return null;
    const now = new Date().toISOString();
    if (review.action === 'REQUEST_CHANGES') {
      c.status = 'CHANGES_REQUESTED';
      c.reviewNote = review.note.trim().slice(0, 2000);
    } else if (review.action === 'APPROVE_MODULES') {
      for (const m of c.modules) if (m.pendingReview) delete m.pendingReview;
      c.modulesSubmittedAt = null;
      c.reviewNote = null;
    } else {
      c.modulesSubmittedAt = null;
      c.reviewNote = review.note.trim().slice(0, 2000);
    }
    c.updatedAt = now;
    return c;
  });
  if (!updated) return { ok: false, code: 'NOT_FOUND' };
  if (review.action === 'APPROVE_MODULES') await (await import('./notify')).notifyModulesReleased(course, updated);
  return { ok: true, value: updated };
}
