/**
 * Training feedback — the shapes shared by the store, the routes, the host's
 * editor and the participant's page, plus the one rule that turns answers
 * into results.
 *
 * Pure: no store, no crypto. The client imports this file too.
 */

export type FeedbackQuestionKind = 'RATING' | 'TEXT';

export interface FeedbackQuestion {
  /** Stable for the life of the question: answers point at it. */
  id: string;
  kind: FeedbackQuestionKind;
  label: string;
  required: boolean;
}

export interface FeedbackAnswer {
  questionId: string;
  /** RATING: 0–5 stars. Absent when an optional question was skipped. */
  rating?: number | null;
  /** TEXT: what the participant wrote. */
  text?: string | null;
}

export type FeedbackLang = 'fr' | 'en' | 'ar';

export const FEEDBACK_LIMITS = {
  questions: 20,
  label: 200,
  title: 160,
  intro: 600,
  text: 2000,
  maxRating: 5,
} as const;

type DefaultQuestion = { key: string; kind: FeedbackQuestionKind; required: boolean };

/** The questions every new form starts with, in this order. */
const DEFAULTS: DefaultQuestion[] = [
  { key: 'overall', kind: 'RATING', required: true },
  { key: 'trainer', kind: 'RATING', required: true },
  { key: 'content', kind: 'RATING', required: true },
  { key: 'room', kind: 'RATING', required: false },
  { key: 'breaks', kind: 'RATING', required: false },
  { key: 'organisation', kind: 'RATING', required: false },
  { key: 'liked', kind: 'TEXT', required: false },
  { key: 'improve', kind: 'TEXT', required: false },
];

const DEFAULT_LABELS: Record<FeedbackLang, Record<string, string>> = {
  fr: {
    title: 'Questionnaire de satisfaction',
    overall: 'Votre avis global sur la formation',
    trainer: 'Le formateur (clarté, maîtrise du sujet)',
    content: 'Le contenu de la formation',
    room: 'La salle de formation (confort, équipement)',
    breaks: 'La pause café / déjeuner',
    organisation: 'L’organisation générale',
    liked: 'Qu’avez-vous le plus apprécié ?',
    improve: 'Que pourrions-nous améliorer ?',
  },
  en: {
    title: 'Satisfaction survey',
    overall: 'Your overall opinion of the training',
    trainer: 'The trainer (clarity, command of the subject)',
    content: 'The content of the training',
    room: 'The training room (comfort, equipment)',
    breaks: 'The coffee / lunch break',
    organisation: 'The overall organisation',
    liked: 'What did you appreciate most?',
    improve: 'What could we improve?',
  },
  ar: {
    title: 'استبيان الرضا',
    overall: 'رأيك العام في التكوين',
    trainer: 'المكوّن (الوضوح، التمكّن من الموضوع)',
    content: 'محتوى التكوين',
    room: 'قاعة التكوين (الراحة، التجهيزات)',
    breaks: 'استراحة القهوة / الغداء',
    organisation: 'التنظيم العام',
    liked: 'ما الذي أعجبك أكثر؟',
    improve: 'ما الذي يمكننا تحسينه؟',
  },
};

export function defaultFeedbackTitle(lang: FeedbackLang): string {
  return DEFAULT_LABELS[lang].title!;
}

/** The starting questions, with fresh ids from `newId`. */
export function defaultFeedbackQuestions(lang: FeedbackLang, newId: () => string): FeedbackQuestion[] {
  return DEFAULTS.map((q) => ({
    id: newId(),
    kind: q.kind,
    required: q.required,
    label: DEFAULT_LABELS[lang][q.key]!,
  }));
}

export interface FeedbackQuestionResult {
  questionId: string;
  label: string;
  kind: FeedbackQuestionKind;
  /** RATING only: mean of the answers given, null when nobody rated it. */
  average: number | null;
  /** How many answered it. */
  count: number;
  /** RATING only: how many gave 0, 1, … 5 stars. */
  distribution: number[];
}

export interface FeedbackResults {
  /** Mean of every star answer to a current question; null with none. */
  overall: number | null;
  responses: number;
  questions: FeedbackQuestionResult[];
}

/** One decimal, the way the rating is shown. */
export function roundRating(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The results of a form, from its responses.
 *
 * Only the CURRENT questions count: a question the host deleted no longer
 * weighs on the overall rating, though its answers stay stored. A 0 is an
 * answer (zero stars) and counts; a skipped optional question does not.
 */
export function computeFeedbackResults(
  questions: FeedbackQuestion[],
  responses: Array<{ answers: FeedbackAnswer[] }>,
): FeedbackResults {
  let sum = 0;
  let n = 0;
  const perQuestion = questions.map((q): FeedbackQuestionResult => {
    const distribution = [0, 0, 0, 0, 0, 0];
    let qSum = 0;
    let count = 0;
    for (const r of responses) {
      const a = r.answers.find((x) => x.questionId === q.id);
      if (!a) continue;
      if (q.kind === 'RATING') {
        if (typeof a.rating !== 'number' || !Number.isInteger(a.rating)) continue;
        if (a.rating < 0 || a.rating > FEEDBACK_LIMITS.maxRating) continue;
        distribution[a.rating]! += 1;
        qSum += a.rating;
        count += 1;
      } else if (a.text && a.text.trim()) {
        count += 1;
      }
    }
    sum += qSum;
    if (q.kind === 'RATING') n += count;
    return {
      questionId: q.id,
      label: q.label,
      kind: q.kind,
      average: q.kind === 'RATING' && count > 0 ? roundRating(qSum / count) : null,
      count,
      distribution: q.kind === 'RATING' ? distribution : [],
    };
  });

  return {
    overall: n > 0 ? roundRating(sum / n) : null,
    responses: responses.length,
    questions: perQuestion,
  };
}

export type AnswerCheck =
  | { ok: true; answers: FeedbackAnswer[] }
  | { ok: false; reason: 'MISSING_REQUIRED' | 'INVALID_ANSWER'; questionId?: string };

/**
 * Check a participant's answers against the form as it stands, and keep only
 * what belongs: answers to questions that exist, of the right kind, in range.
 * Unknown questions are dropped rather than refused — a page opened before the
 * host edited the form should still be able to send.
 */
export function checkFeedbackAnswers(questions: FeedbackQuestion[], raw: FeedbackAnswer[]): AnswerCheck {
  const byId = new Map(raw.map((a) => [a.questionId, a]));
  const answers: FeedbackAnswer[] = [];
  for (const q of questions) {
    const a = byId.get(q.id);
    if (q.kind === 'RATING') {
      const r = a?.rating;
      if (r === undefined || r === null) {
        if (q.required) return { ok: false, reason: 'MISSING_REQUIRED', questionId: q.id };
        continue;
      }
      if (!Number.isInteger(r) || r < 0 || r > FEEDBACK_LIMITS.maxRating) {
        return { ok: false, reason: 'INVALID_ANSWER', questionId: q.id };
      }
      answers.push({ questionId: q.id, rating: r });
    } else {
      const text = (a?.text ?? '').trim();
      if (!text) {
        if (q.required) return { ok: false, reason: 'MISSING_REQUIRED', questionId: q.id };
        continue;
      }
      if (text.length > FEEDBACK_LIMITS.text) return { ok: false, reason: 'INVALID_ANSWER', questionId: q.id };
      answers.push({ questionId: q.id, text });
    }
  }
  return { ok: true, answers };
}
