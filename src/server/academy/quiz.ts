/**
 * Module quizzes — what a learner sees, and marking their answers.
 *
 * The right answers never leave the server: the learner view carries the
 * options only, and an attempt comes back with a score and which questions
 * were wrong, not the correct option. Retries are allowed (owner decision);
 * the best score is kept and a pass is never taken back by a worse attempt.
 */
import { db } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { ACADEMY_QUIZ_PASS_SCORE, isLiveModule, isQuizPassed, quizScore } from '@/lib/academy';
import { courseReach, type Viewer } from './access';

export interface LearnerQuizResult { bestScore: number; attempts: number; passedAt: string | null }

export interface LearnerQuiz {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  passScore: number;
  questions: { id: string; prompt: string; options: string[] }[];
  result: LearnerQuizResult | null;
}

export type QuizError = 'NOT_FOUND' | 'LOCKED' | 'NO_QUIZ' | 'INVALID_ANSWERS';

/** Quizzes are for learners with the course (bought or Pass) and admins — not previews. */
async function quizModule(viewer: Viewer, courseId: string, moduleId: string) {
  const reach = await courseReach(viewer, courseId);
  if (!reach.ok) return { ok: false as const, code: 'NOT_FOUND' as const };
  if (!reach.access) return { ok: false as const, code: 'LOCKED' as const };
  const mod = reach.course.modules.find((m) => m.id === moduleId);
  if (!mod || (!isLiveModule(mod) && reach.access !== 'ADMIN')) return { ok: false as const, code: 'NOT_FOUND' as const };
  if (!mod.quiz?.questions.length) return { ok: false as const, code: 'NO_QUIZ' as const };
  return { ok: true as const, mod, quiz: mod.quiz, reach };
}

export async function getLearnerQuiz(
  viewer: Viewer, courseId: string, moduleId: string, locale: string,
): Promise<{ ok: true; quiz: LearnerQuiz } | { ok: false; code: QuizError }> {
  const q = await quizModule(viewer, courseId, moduleId);
  if (!q.ok) return q;
  const r = q.reach.d.academyQuizResults?.find((x) => x.userId === viewer.id && x.moduleId === moduleId && x.courseId === courseId);
  return {
    ok: true,
    quiz: {
      courseId,
      moduleId,
      moduleTitle: resolveText(q.mod.title, locale),
      passScore: ACADEMY_QUIZ_PASS_SCORE,
      questions: q.quiz.questions.map((x) => ({
        id: x.id,
        prompt: resolveText(x.prompt, locale),
        options: x.options.map((o) => resolveText(o, locale)),
      })),
      result: r ? { bestScore: r.bestScore, attempts: r.attempts, passedAt: r.passedAt } : null,
    },
  };
}

export interface QuizAttemptOutcome {
  score: number;
  passed: boolean;
  /** Question ids answered wrong — the learner sees where to look again, not the answer. */
  wrong: string[];
  result: LearnerQuizResult;
}

/** Mark one attempt. `answers` maps each question id to the chosen option index. */
export async function submitQuizAttempt(
  viewer: Viewer, courseId: string, moduleId: string, answers: Record<string, number>,
): Promise<{ ok: true; outcome: QuizAttemptOutcome } | { ok: false; code: QuizError }> {
  const q = await quizModule(viewer, courseId, moduleId);
  if (!q.ok) return q;
  const questions = q.quiz.questions;
  // Every current question answered, nothing else: a stale form after an edit is refused.
  const keys = Object.keys(answers);
  if (keys.length !== questions.length || !questions.every((x) => Number.isInteger(answers[x.id]))) {
    return { ok: false, code: 'INVALID_ANSWERS' };
  }
  const chosen = questions.map((x) => answers[x.id]!);
  const score = quizScore(questions.map((x) => x.correctIndex), chosen);
  const passed = isQuizPassed(score);
  const wrong = questions.filter((x, i) => chosen[i] !== x.correctIndex).map((x) => x.id);

  // An admin trying a quiz while reviewing leaves no result behind.
  if (q.reach.access === 'ADMIN') {
    return { ok: true, outcome: { score, passed, wrong, result: { bestScore: score, attempts: 1, passedAt: null } } };
  }

  const at = new Date().toISOString();
  const result = await db.update((d) => {
    if (!Array.isArray(d.academyQuizResults)) d.academyQuizResults = [];
    let r = d.academyQuizResults.find((x) => x.userId === viewer.id && x.moduleId === moduleId && x.courseId === courseId);
    if (!r) {
      r = { userId: viewer.id, courseId, moduleId, bestScore: 0, attempts: 0, passedAt: null, lastAttemptAt: at };
      d.academyQuizResults.push(r);
    }
    r.attempts += 1;
    r.bestScore = Math.max(r.bestScore, score);
    r.lastAttemptAt = at;
    if (passed && !r.passedAt) r.passedAt = at;
    return { bestScore: r.bestScore, attempts: r.attempts, passedAt: r.passedAt };
  });
  return { ok: true, outcome: { score, passed, wrong, result } };
}
