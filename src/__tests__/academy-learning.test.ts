/**
 * Startup Academy phase 5 — the learning experience: module quizzes (answers
 * never leave the server), certificates (90 % watched + every quiz at 70 %,
 * frozen once issued, refunds closed), reviews (25 % watched, live at once,
 * admin hides, mentor replies once), lesson Q&A and notes, wishlist,
 * new-module notices and "keep going" reminders.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type AcademyCourseRecord } from '@/server/db/store';
import { getLearnerQuiz, submitQuizAttempt } from '@/server/academy/quiz';
import { certificateProgress, claimCertificate, setCertificateRevoked } from '@/server/academy/certificates';
import { deleteMyReview, listCourseReviews, replyToReview, reviewEligibility, reviewerName, saveReview, setReviewHidden } from '@/server/academy/reviews';
import { addMyNote, listLessonQuestions, postAsLearner, postAsMentor, questionInbox, setPostHidden } from '@/server/academy/qa';
import { setWishlisted } from '@/server/academy/wishlist';
import { notifyModulesReleased, runAcademyReminders } from '@/server/academy/notify';
import { cleanDraft, draftModuleQuiz } from '@/server/academy/quiz-draft';
import { courseDraftSchema, getPublicCourse, saveCourseDraft, type CourseDraftInput } from '@/server/academy/catalog';
import { refundCheck } from '@/server/academy/orders';
import { verifyCertificate } from '@/server/certificates/verify';
import { createMemoryAcademyRepo, setAcademyRepoForTests } from '@/server/academy/repo';
import { isLessonWatched, quizScore } from '@/lib/academy';

const NOW = new Date().toISOString();
const THUMB = 'https://res.cloudinary.com/demo/image/upload/v1/metwork/academy/c.jpg';
const repo = createMemoryAcademyRepo();

const lesson = (id: string) => ({
  id, title: { source: 'fr', fr: id }, description: null, kind: 'VIDEO', videoId: 'a'.repeat(32), videoStatus: 'READY', durationSec: 60, isPreview: false, resources: [],
});
const quiz = {
  questions: [
    { id: 'q1', prompt: { source: 'fr', fr: 'Q1' }, options: [{ source: 'fr', fr: 'a' }, { source: 'fr', fr: 'b' }], correctIndex: 1 },
    { id: 'q2', prompt: { source: 'fr', fr: 'Q2' }, options: [{ source: 'fr', fr: 'a' }, { source: 'fr', fr: 'b' }, { source: 'fr', fr: 'c' }], correctIndex: 0 },
    { id: 'q3', prompt: { source: 'fr', fr: 'Q3' }, options: [{ source: 'fr', fr: 'a' }, { source: 'fr', fr: 'b' }], correctIndex: 0 },
  ],
};
function course(extra: Partial<AcademyCourseRecord> = {}): AcademyCourseRecord {
  return {
    id: 'c-1', slug: 'c-1', fieldId: 'ideation', mentorIds: ['m-1'], title: { source: 'fr', fr: 'Créer sa SARL' }, subtitle: null, description: { source: 'fr', fr: 'd' },
    outcomes: [], level: 'BEGINNER', audioLanguage: 'DARIJA_FR', priceDzd: 2900, includedInPass: true, thumbnailUrl: THUMB, trailerVideoId: null,
    status: 'PUBLISHED', createdBy: { kind: 'ADMIN', id: 'admin' }, reviewNote: null, submittedAt: null, publishedAt: NOW, createdAt: NOW, updatedAt: NOW,
    modules: [
      { id: 'm1', title: { source: 'fr', fr: 'M1' }, comingSoon: false, lessons: [lesson('l1'), lesson('l2')], quiz },
      { id: 'm2', title: { source: 'fr', fr: 'M2' }, comingSoon: true, lessons: [lesson('l3')] },
    ],
    ...extra,
  } as AcademyCourseRecord;
}
const buyer = { id: 'u-buyer', role: 'ENTREPRENEUR' };
const stranger = { id: 'u-other', role: 'ENTREPRENEUR' };
const admin = { id: 'admin', role: 'ADMIN' };

/** Watch a lesson "for real": server-side watch time plus the completion stamp. */
async function watch(userId: string, lessonId: string, seconds = 30) {
  await repo.addWatch({ userId, lessonId, courseId: 'c-1', mentorId: 'm-1', access: 'OWNED', day: '2026-11-01', elapsedSec: seconds, lessonDurationSec: 60 });
  await repo.saveProgress({ userId, courseId: 'c-1', lessonId, positionSec: 60, completed: true });
}
const passQuiz = (user = buyer) => submitQuizAttempt(user, 'c-1', 'm1', { q1: 1, q2: 0, q3: 0 });

beforeEach(async () => {
  repo.reset();
  setAcademyRepoForTests(repo);
  await db.update((d) => {
    d.users = [
      { id: 'admin', role: 'ADMIN', email: 'a@x.dz', fullName: 'Admin', locale: 'fr' } as never,
      { id: 'u-buyer', role: 'ENTREPRENEUR', email: 'b@x.dz', fullName: 'Amina Benali', locale: 'fr' } as never,
      { id: 'u-other', role: 'ENTREPRENEUR', email: 'o@x.dz', fullName: 'Karim Saadi', locale: 'ar' } as never,
    ];
    d.mentors = [{ id: 'm-1', fullName: 'Yacine Kheddaoui', approvalStatus: 'APPROVED' } as never, { id: 'm-2', fullName: 'Nadia', approvalStatus: 'APPROVED' } as never];
    d.academyCourses = [course()];
    d.academyEnrollments = [{
      id: 'e-1', userId: 'u-buyer', courseId: 'c-1', source: 'PURCHASE', listPriceDzd: 2900, pricePaidDzd: 2900, discount: 'NONE', mentorShareRate: 0.3,
      paymentRef: 'o-1', createdAt: NOW, refundedAt: null, revokedAt: null,
    }];
    d.academyPasses = [];
    d.academyQuizResults = [];
    d.academyReviews = [];
    d.academyCertificates = [];
    d.academyReminders = [];
    d.academySettings = null;
    d.notifications = [];
  });
});

describe('rules', () => {
  it('scores quizzes and counts a lesson watched at 90 %, allowing 2× playback', () => {
    expect(quizScore([1, 0, 0], [1, 0, 1])).toBeCloseTo(2 / 3);
    expect(quizScore([], [])).toBe(0);
    expect(isLessonWatched(27, 60)).toBe(true); // 27 s of wall time at 2× = 54 s = 90 %
    expect(isLessonWatched(26, 60)).toBe(false);
    expect(isLessonWatched(100, 0)).toBe(false);
  });
});

describe('module quizzes', () => {
  it('the learner view carries no answers', async () => {
    const res = await getLearnerQuiz(buyer, 'c-1', 'm1', 'fr');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(JSON.stringify(res.quiz)).not.toContain('correctIndex');
    expect(res.quiz.questions[1]!.options).toEqual(['a', 'b', 'c']);
  });

  it('only learners with the course take it; a coming-soon module has none to take', async () => {
    expect(await getLearnerQuiz(stranger, 'c-1', 'm1', 'fr')).toEqual({ ok: false, code: 'LOCKED' });
    expect(await getLearnerQuiz(buyer, 'c-1', 'm2', 'fr')).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('marks an attempt, keeps the best score and never takes a pass back', async () => {
    const fail = await submitQuizAttempt(buyer, 'c-1', 'm1', { q1: 0, q2: 0, q3: 1 });
    expect(fail).toMatchObject({ ok: true, outcome: { passed: false, wrong: ['q1', 'q3'] } });
    const pass = await passQuiz();
    expect(pass).toMatchObject({ ok: true, outcome: { score: 1, passed: true } });
    await submitQuizAttempt(buyer, 'c-1', 'm1', { q1: 0, q2: 1, q3: 1 });
    const r = (await db.read()).academyQuizResults![0]!;
    expect(r).toMatchObject({ attempts: 3, bestScore: 1 });
    expect(r.passedAt).not.toBeNull();
  });

  it('refuses incomplete or stale answers; an admin trying it leaves no result', async () => {
    expect(await submitQuizAttempt(buyer, 'c-1', 'm1', { q1: 1, q2: 0 })).toEqual({ ok: false, code: 'INVALID_ANSWERS' });
    expect(await submitQuizAttempt(buyer, 'c-1', 'm1', { q1: 1, q2: 0, qX: 0 })).toEqual({ ok: false, code: 'INVALID_ANSWERS' });
    expect((await passQuiz(admin)).ok).toBe(true);
    expect((await db.read()).academyQuizResults).toHaveLength(0);
  });

  it('the builder keeps question ids across saves and refuses a right answer out of range', async () => {
    const c = (await db.read()).academyCourses![0]!;
    const input: CourseDraftInput = {
      slug: c.slug, fieldId: c.fieldId, mentorIds: c.mentorIds, title: c.title, subtitle: c.subtitle, description: c.description, outcomes: [],
      level: c.level, audioLanguage: c.audioLanguage, priceDzd: c.priceDzd, includedInPass: true, thumbnailUrl: c.thumbnailUrl,
      modules: c.modules.map((m) => ({ id: m.id, title: m.title, comingSoon: m.comingSoon, lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, description: null, isPreview: false })), quiz: m.quiz ?? null })),
    };
    const res = await saveCourseDraft('c-1', input);
    expect(res.ok && res.value.modules[0]!.quiz!.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    const bad = { ...input, modules: [{ ...input.modules[0]!, quiz: { questions: [{ ...quiz.questions[0]!, correctIndex: 5 }] } }] };
    expect(courseDraftSchema.safeParse(bad).success).toBe(false);
    // The public course shows how many questions, never the questions.
    const pub = await getPublicCourse('c-1', 'fr');
    expect(pub!.modules[0]!.quizQuestions).toBe(3);
    expect(JSON.stringify(pub)).not.toContain('correctIndex');
  });
});

describe('certificates', () => {
  it('needs real watch time on every released lesson and every quiz passed', async () => {
    // "Mark as done" alone (no watch time) is not enough.
    await repo.saveProgress({ userId: 'u-buyer', courseId: 'c-1', lessonId: 'l1', positionSec: 0, completed: true });
    await repo.saveProgress({ userId: 'u-buyer', courseId: 'c-1', lessonId: 'l2', positionSec: 0, completed: true });
    let p = await certificateProgress('u-buyer', course(), await db.read());
    expect(p).toMatchObject({ lessonsTotal: 2, lessonsDone: 0, quizzesTotal: 1, eligible: false });
    await watch('u-buyer', 'l1');
    await watch('u-buyer', 'l2');
    expect(await claimCertificate(buyer, 'c-1')).toMatchObject({ ok: false, code: 'NOT_ELIGIBLE' });
    await passQuiz();
    p = await certificateProgress('u-buyer', course(), await db.read());
    expect(p.eligible).toBe(true);
  });

  it('issues once with a frozen number, then closes refunds and verifies publicly', async () => {
    await watch('u-buyer', 'l1'); await watch('u-buyer', 'l2'); await passQuiz();
    const first = await claimCertificate(buyer, 'c-1');
    expect(first).toMatchObject({ ok: true, created: true, certificate: { fullName: 'Amina Benali', courseTitle: 'Créer sa SARL', mentorNames: 'Yacine Kheddaoui', access: 'OWNED' } });
    if (!first.ok) return;
    expect(first.certificate.number).toMatch(/^ACA-\d{4}-0001$/);
    const again = await claimCertificate(buyer, 'c-1');
    expect(again).toMatchObject({ ok: true, created: false, certificate: { id: first.certificate.id } });
    expect((await db.read()).academyCertificates).toHaveLength(1);

    expect(await refundCheck('u-buyer', 'e-1')).toEqual({ eligible: false, reason: 'CERTIFIED' });
    expect(await verifyCertificate(first.certificate.verifyToken)).toMatchObject({ status: 'VALID', number: first.certificate.number, programTitle: 'Créer sa SARL' });
    await setCertificateRevoked(first.certificate.id, true);
    expect(await verifyCertificate(first.certificate.verifyToken)).toMatchObject({ status: 'REVOKED' });
  });

  it('admins and non-learners never get one; a missing name blocks it', async () => {
    expect(await claimCertificate(admin, 'c-1')).toMatchObject({ ok: false, code: 'LOCKED' });
    expect(await claimCertificate(stranger, 'c-1')).toMatchObject({ ok: false, code: 'LOCKED' });
    await watch('u-buyer', 'l1'); await watch('u-buyer', 'l2'); await passQuiz();
    await db.update((d) => { d.users.find((u) => u.id === 'u-buyer')!.fullName = '  '; });
    expect(await claimCertificate(buyer, 'c-1')).toMatchObject({ ok: false, code: 'NAME_MISSING' });
  });
});

describe('reviews', () => {
  it('learners who watched a quarter of the course may review; edits replace their review', async () => {
    expect(await reviewEligibility(stranger, 'c-1')).toMatchObject({ canReview: false, reason: 'NOT_LEARNER' });
    expect(await reviewEligibility(buyer, 'c-1')).toMatchObject({ canReview: false, reason: 'WATCH_MORE' });
    await watch('u-buyer', 'l1'); // 30 s of 120 s released = 25 %
    expect(await saveReview(buyer, 'c-1', { rating: 4, text: ' Très clair ' })).toMatchObject({ ok: true });
    expect(await saveReview(buyer, 'c-1', { rating: 5, text: null })).toMatchObject({ ok: true });
    const list = await listCourseReviews('c-1');
    expect(list).toEqual([expect.objectContaining({ author: 'Amina B.', rating: 5, text: null })]);
    expect((await getPublicCourse('c-1', 'fr'))!.rating).toEqual({ average: 5, count: 1 });
  });

  it('a hidden review leaves the page and the average; the mentor replies once', async () => {
    await watch('u-buyer', 'l1');
    await saveReview(buyer, 'c-1', { rating: 2, text: 'Bof' });
    const id = (await db.read()).academyReviews![0]!.id;
    expect(await replyToReview('m-2', id, 'Merci')).toEqual({ ok: false, code: 'NOT_YOUR_COURSE' });
    expect(await replyToReview('m-1', id, 'Merci pour votre retour')).toEqual({ ok: true });
    expect(await replyToReview('m-1', id, 'Encore')).toEqual({ ok: false, code: 'ALREADY_REPLIED' });
    expect((await listCourseReviews('c-1'))[0]!.reply).toMatchObject({ mentorName: 'Yacine Kheddaoui', text: 'Merci pour votre retour' });
    await setReviewHidden(id, 'admin', true);
    expect(await listCourseReviews('c-1')).toEqual([]);
    expect((await getPublicCourse('c-1', 'fr'))!.rating).toEqual({ average: null, count: 0 });
    expect(await deleteMyReview('u-buyer', 'c-1')).toBe(true);
  });

  it('shows a first name and an initial only', () => {
    expect(reviewerName('Amina Benali')).toBe('Amina B.');
    expect(reviewerName('Karim')).toBe('Karim');
    expect(reviewerName('')).toBe('—');
  });
});

describe('lesson Q&A and notes', () => {
  it('is for the course’s learners; the mentor’s answer notifies the asker', async () => {
    expect(await listLessonQuestions(stranger, 'c-1', 'l1')).toEqual({ ok: false, code: 'LOCKED' });
    const q = await postAsLearner(buyer, { courseId: 'c-1', lessonId: 'l1', parentId: null, body: 'Faut-il un local ?' });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(await postAsMentor('m-2', { courseId: 'c-1', lessonId: 'l1', parentId: q.post.id, body: 'x' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    const a = await postAsMentor('m-1', { courseId: 'c-1', lessonId: 'l1', parentId: q.post.id, body: 'Une domiciliation suffit.' });
    expect(a.ok).toBe(true);
    const notes = (await db.read()).notifications!.filter((n) => n.userId === 'u-buyer');
    expect(notes).toEqual([expect.objectContaining({ type: 'ACADEMY_LEARNING', href: '/academy/learn/c-1/l1?tab=qa' })]);
    // No answers to answers.
    expect(await postAsLearner(buyer, { courseId: 'c-1', lessonId: 'l1', parentId: a.ok ? a.post.id : '', body: 'ok' })).toEqual({ ok: false, code: 'NOT_A_QUESTION' });
    const thread = await listLessonQuestions(buyer, 'c-1', 'l1');
    expect(thread.ok && thread.questions[0]).toMatchObject({ author: 'Amina B.', mine: true, answers: [{ authorKind: 'MENTOR', author: 'Yacine Kheddaoui' }] });
  });

  it('hidden posts are gone for learners, kept for the admin; the inbox puts unanswered first', async () => {
    const q1 = await postAsLearner(buyer, { courseId: 'c-1', lessonId: 'l1', parentId: null, body: 'Première' });
    const q2 = await postAsLearner(buyer, { courseId: 'c-1', lessonId: 'l2', parentId: null, body: 'Deuxième' });
    if (!q1.ok || !q2.ok) throw new Error('setup');
    await postAsMentor('m-1', { courseId: 'c-1', lessonId: 'l1', parentId: q1.post.id, body: 'Réponse' });
    const inbox = await questionInbox(['c-1'], 'fr', { includeHidden: false });
    expect(inbox.map((x) => [x.body, x.answeredByMentor])).toEqual([['Deuxième', false], ['Première', true]]);
    await setPostHidden(q2.post.id, 'admin', true);
    const forLearner = await listLessonQuestions(buyer, 'c-1', 'l2');
    expect(forLearner.ok && forLearner.questions).toEqual([]);
    const forAdmin = await listLessonQuestions(admin, 'c-1', 'l2');
    expect(forAdmin.ok && forAdmin.questions[0]).toMatchObject({ hidden: true });
  });

  it('notes belong to their author only', async () => {
    const n = await addMyNote(buyer, { courseId: 'c-1', lessonId: 'l1', positionSec: 999, body: 'À revoir' });
    expect(n).toMatchObject({ ok: true, note: { positionSec: 60 } }); // clamped to the lesson
    if (!n.ok) return;
    expect(await repo.updateNote('u-other', n.note.id, 'piraté')).toBe(false);
    expect(await repo.deleteNote('u-other', n.note.id)).toBe(false);
    expect(await addMyNote(stranger, { courseId: 'c-1', lessonId: 'l1', positionSec: 0, body: 'x' })).toMatchObject({ ok: false, code: 'LOCKED' });
    await repo.deleteUser('u-buyer');
    expect(await repo.listNotes('u-buyer', 'c-1')).toEqual([]);
  });
});

describe('wishlist, release notices and reminders', () => {
  it('only published courses can be wishlisted', async () => {
    expect(await setWishlisted('u-other', 'c-1', true)).toEqual({ ok: true, wishlisted: true });
    await db.update((d) => { d.academyCourses!.push(course({ id: 'c-draft', slug: 'c-draft', status: 'DRAFT' })); });
    expect(await setWishlisted('u-other', 'c-draft', true)).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('a module going live notifies buyers and wishlisters, once', async () => {
    await setWishlisted('u-other', 'c-1', true);
    const before = course();
    const after = course({ modules: before.modules.map((m) => ({ ...m, comingSoon: false })) });
    expect(await notifyModulesReleased(before, after)).toBe(2);
    expect(await notifyModulesReleased(after, after)).toBe(0);
    const n = (await db.read()).notifications!;
    expect(n.map((x) => x.userId).sort()).toEqual(['u-buyer', 'u-other']);
    expect(n[0]!.body).toContain('M2');
  });

  it('sends one reminder per pause, skips finished courses and learners who opted out', async () => {
    await watch('u-buyer', 'l1');
    const later = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    expect(await runAcademyReminders(later)).toMatchObject({ candidates: 1, sent: 1 });
    expect(await runAcademyReminders(later)).toMatchObject({ sent: 0, skipped: 1 });
    expect((await db.read()).academyReminders![0]).toMatchObject({ count: 1 });

    await db.update((d) => { d.academyReminders = []; d.users.find((u) => u.id === 'u-buyer')!.academyRemindersOff = true; });
    expect(await runAcademyReminders(later)).toMatchObject({ sent: 0 });
    await db.update((d) => { d.users.find((u) => u.id === 'u-buyer')!.academyRemindersOff = false; });
    await watch('u-buyer', 'l2');
    expect(await runAcademyReminders(later)).toMatchObject({ sent: 0 });
  });
});

describe('AI quiz drafts', () => {
  it('keeps only well-formed questions', () => {
    const out = cleanDraft([
      { prompt: 'OK ?', options: ['a', 'b', 'c', 'd'], correctIndex: 2 },
      { prompt: '', options: ['a', 'b'], correctIndex: 0 },
      { prompt: 'Out of range', options: ['a', 'b'], correctIndex: 4 },
      { prompt: 'One option', options: ['a'], correctIndex: 0 },
    ], 5);
    expect(out).toEqual([{ prompt: 'OK ?', options: ['a', 'b', 'c', 'd'], correctIndex: 2 }]);
  });

  it('drafts in the course language from the module’s lessons, nothing saved', async () => {
    let seen = '';
    const res = await draftModuleQuiz('c-1', 'm1', 3, async ({ language, count, context }) => {
      seen = `${language}|${count}|${context}`;
      return [{ prompt: 'Quel statut ?', options: ['SARL', 'EURL'], correctIndex: 0 }];
    });
    expect(res).toEqual({ ok: true, language: 'fr', questions: [{ prompt: 'Quel statut ?', options: ['SARL', 'EURL'], correctIndex: 0 }] });
    expect(seen).toContain('fr|3|');
    expect(seen).toContain('<lesson title="l1">');
    expect((await db.read()).academyCourses![0]!.modules[0]!.quiz!.questions).toHaveLength(3);
  });
});
