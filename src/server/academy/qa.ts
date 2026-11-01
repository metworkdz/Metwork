/**
 * Learner notes and lesson Q&A.
 *
 * Notes are private to their author. Q&A (owner decision 2026-11-01) is public
 * to the course: every learner who has it (bought or Pass) reads the questions
 * and answers, asks, and may answer; the course's mentors answer from the
 * Studio, flagged as the mentor; the admin hides any post. Preview viewers see
 * none of it.
 */
import { db, type AcademyCourseRecord } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { createNotification } from '@/server/notifications/create-notification';
import { pushToMentor } from '@/server/notifications/push';
import { academyRepo, type LessonNote, type LessonPost, type PostAuthorKind } from './repo';
import { courseReach, lessonAccess, type Viewer } from './access';
import { reviewerName } from './reviews';

export const NOTE_MAX = 2000;
export const POST_MAX = 2000;

type StoreData = Awaited<ReturnType<typeof db.read>>;

/* ─────────────────────────── Notes ─────────────────────────── */

export async function listMyNotes(viewer: Viewer, courseId: string): Promise<LessonNote[] | null> {
  const reach = await courseReach(viewer, courseId);
  if (!reach.ok) return null;
  return academyRepo().listNotes(viewer.id, courseId);
}

export async function addMyNote(
  viewer: Viewer, input: { courseId: string; lessonId: string; positionSec: number; body: string },
): Promise<{ ok: true; note: LessonNote } | { ok: false; code: string }> {
  const access = await lessonAccess(viewer, input.courseId, input.lessonId);
  if (!access.ok) return access;
  const body = input.body.trim().slice(0, NOTE_MAX);
  if (!body) return { ok: false, code: 'EMPTY' };
  const positionSec = Math.min(Math.max(0, Math.floor(input.positionSec)), access.lesson.durationSec || 0);
  const note = await academyRepo().addNote({ userId: viewer.id, courseId: input.courseId, lessonId: input.lessonId, positionSec, body });
  return { ok: true, note };
}

/* ─────────────────────────── Q&A ─────────────────────────── */

export interface PostView {
  id: string;
  parentId: string | null;
  author: string;
  authorKind: PostAuthorKind;
  mine: boolean;
  body: string;
  createdAt: string;
  hidden: boolean;
}

export interface QuestionView extends PostView { answers: PostView[] }

function authorName(d: StoreData, p: LessonPost): string {
  if (p.authorKind === 'MENTOR') return d.mentors.find((m) => m.id === p.authorId)?.fullName ?? 'Mentor';
  if (p.authorKind === 'ADMIN') return 'Metwork';
  return reviewerName(d.users.find((u) => u.id === p.authorId)?.fullName);
}

function threads(d: StoreData, posts: LessonPost[], me: { kind: PostAuthorKind; id: string } | null): QuestionView[] {
  const view = (p: LessonPost): PostView => ({
    id: p.id,
    parentId: p.parentId,
    author: authorName(d, p),
    authorKind: p.authorKind,
    mine: Boolean(me && me.kind === p.authorKind && me.id === p.authorId),
    body: p.body,
    createdAt: p.createdAt,
    hidden: Boolean(p.hiddenAt),
  });
  const questions = posts.filter((p) => !p.parentId);
  return questions
    .map((q) => ({ ...view(q), answers: posts.filter((a) => a.parentId === q.id).map(view) }))
    // Newest questions first; answers stay in the order they were written.
    .reverse();
}

export type QaError = 'NOT_FOUND' | 'LOCKED' | 'EMPTY' | 'NOT_A_QUESTION';

/** Who may read a course's Q&A, and as whom they post. */
async function qaActor(viewer: Viewer, courseId: string) {
  const reach = await courseReach(viewer, courseId);
  if (!reach.ok) return { ok: false as const, code: 'NOT_FOUND' as const };
  if (!reach.access) return { ok: false as const, code: 'LOCKED' as const };
  const kind: PostAuthorKind = reach.access === 'ADMIN' ? 'ADMIN' : 'USER';
  return { ok: true as const, reach, actor: { kind, id: viewer.id } };
}

function lessonOf(course: AcademyCourseRecord, lessonId: string) {
  return course.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId) ?? null;
}

export async function listLessonQuestions(viewer: Viewer, courseId: string, lessonId: string): Promise<{ ok: true; questions: QuestionView[] } | { ok: false; code: QaError }> {
  const a = await qaActor(viewer, courseId);
  if (!a.ok) return a;
  if (!lessonOf(a.reach.course, lessonId)) return { ok: false, code: 'NOT_FOUND' };
  const posts = await academyRepo().listPosts(courseId, lessonId, { includeHidden: a.actor.kind === 'ADMIN' });
  return { ok: true, questions: threads(a.reach.d, posts, a.actor) };
}

/** Mentors read a lesson's Q&A from the Studio, for their own courses only. */
export async function listLessonQuestionsForMentor(mentorId: string, courseId: string, lessonId: string): Promise<QuestionView[] | null> {
  const d = await db.read();
  const course = d.academyCourses?.find((c) => c.id === courseId && c.mentorIds.includes(mentorId));
  if (!course || !lessonOf(course, lessonId)) return null;
  const posts = await academyRepo().listPosts(courseId, lessonId);
  return threads(d, posts, { kind: 'MENTOR', id: mentorId });
}

async function notifyAnswer(d: StoreData, question: LessonPost, answer: LessonPost) {
  if (question.authorKind !== 'USER' || (answer.authorKind === 'USER' && answer.authorId === question.authorId)) return;
  const course = d.academyCourses?.find((c) => c.id === question.courseId);
  if (!course) return;
  const who = answer.authorKind === 'MENTOR' ? authorName(d, answer) : 'Un autre apprenant';
  await createNotification({
    userId: question.authorId,
    type: 'ACADEMY_LEARNING',
    title: 'Réponse à votre question',
    body: `${who} a répondu dans « ${resolveText(course.title, 'fr')} ».`,
    href: `/academy/learn/${course.slug}/${question.lessonId}?tab=qa`,
  });
}

async function notifyMentors(d: StoreData, question: LessonPost) {
  const course = d.academyCourses?.find((c) => c.id === question.courseId);
  if (!course) return;
  for (const mentorId of course.mentorIds) {
    await pushToMentor(mentorId, {
      title: 'Nouvelle question Academy',
      body: `« ${resolveText(course.title, 'fr')} » : ${question.body.slice(0, 120)}`,
      url: '/mentordashboard',
    });
  }
}

async function addPost(
  d: StoreData, course: { id: string }, lessonId: string, parentId: string | null,
  actor: { kind: PostAuthorKind; id: string }, text: string,
): Promise<{ ok: true; post: LessonPost } | { ok: false; code: QaError }> {
  const body = text.trim().slice(0, POST_MAX);
  if (!body) return { ok: false, code: 'EMPTY' };
  const repo = academyRepo();
  let parent: LessonPost | null = null;
  if (parentId) {
    parent = await repo.getPost(parentId);
    // Answers go under a visible question of the same lesson; no answers to answers.
    if (!parent || parent.courseId !== course.id || parent.lessonId !== lessonId || parent.parentId || parent.hiddenAt) {
      return { ok: false, code: 'NOT_A_QUESTION' };
    }
  }
  const post = await repo.addPost({ courseId: course.id, lessonId, parentId, authorKind: actor.kind, authorId: actor.id, body });
  if (parent) await notifyAnswer(d, parent, post);
  else if (actor.kind === 'USER') await notifyMentors(d, post);
  return { ok: true, post };
}

export async function postAsLearner(
  viewer: Viewer, input: { courseId: string; lessonId: string; parentId: string | null; body: string },
): Promise<{ ok: true; post: LessonPost } | { ok: false; code: QaError }> {
  const a = await qaActor(viewer, input.courseId);
  if (!a.ok) return a;
  if (!lessonOf(a.reach.course, input.lessonId)) return { ok: false, code: 'NOT_FOUND' };
  return addPost(a.reach.d, a.reach.course, input.lessonId, input.parentId, a.actor, input.body);
}

/** The mentor answers (or asks, rarely) in one of their own courses. */
export async function postAsMentor(
  mentorId: string, input: { courseId: string; lessonId: string; parentId: string | null; body: string },
): Promise<{ ok: true; post: LessonPost } | { ok: false; code: QaError }> {
  const d = await db.read();
  const course = d.academyCourses?.find((c) => c.id === input.courseId && c.mentorIds.includes(mentorId));
  if (!course || !lessonOf(course, input.lessonId)) return { ok: false, code: 'NOT_FOUND' };
  return addPost(d, course, input.lessonId, input.parentId, { kind: 'MENTOR', id: mentorId }, input.body);
}

export async function setPostHidden(postId: string, adminId: string, hidden: boolean): Promise<boolean> {
  return academyRepo().setPostHidden(postId, hidden ? adminId : null);
}

/* ─────────────────────────── Inboxes ─────────────────────────── */

export interface InboxQuestion {
  id: string;
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  author: string;
  body: string;
  createdAt: string;
  answers: number;
  /** A mentor of the course has answered. */
  answeredByMentor: boolean;
  hidden: boolean;
}

/**
 * Recent questions of some courses: the mentor's Studio inbox (their courses,
 * unanswered first) or the admin's moderation list (every course).
 */
export async function questionInbox(courseIds: string[] | 'ALL', locale: string, opts: { includeHidden: boolean }): Promise<InboxQuestion[]> {
  const d = await db.read();
  const courses = (d.academyCourses ?? []).filter((c) => courseIds === 'ALL' || courseIds.includes(c.id));
  const posts = await academyRepo().listCoursePosts(courses.map((c) => c.id), 500);
  const out: InboxQuestion[] = [];
  for (const q of posts) {
    if (q.parentId || (!opts.includeHidden && q.hiddenAt)) continue;
    const course = courses.find((c) => c.id === q.courseId)!;
    const lesson = lessonOf(course, q.lessonId);
    const answers = posts.filter((a) => a.parentId === q.id && (opts.includeHidden || !a.hiddenAt));
    out.push({
      id: q.id,
      courseId: q.courseId,
      courseTitle: resolveText(course.title, locale),
      lessonId: q.lessonId,
      lessonTitle: lesson ? resolveText(lesson.title, locale) : '',
      author: authorName(d, q),
      body: q.body,
      createdAt: q.createdAt,
      answers: answers.length,
      answeredByMentor: answers.some((a) => a.authorKind === 'MENTOR' && course.mentorIds.includes(a.authorId)),
      hidden: Boolean(q.hiddenAt),
    });
  }
  return out.sort((a, b) => Number(a.answeredByMentor) - Number(b.answeredByMentor) || b.createdAt.localeCompare(a.createdAt));
}
