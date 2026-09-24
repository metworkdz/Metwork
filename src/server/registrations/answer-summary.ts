/**
 * How the confirmed participants answered each multiple-choice question —
 * the demand behind a pre-registration ("online or in person?") at a glance,
 * without reading the table row by row.
 *
 * One subtlety: the seeded default questions are shown to each visitor in
 * THEIR language, and the answer is stored as the text they clicked. A French
 * "Idée" and an Arabic "فكرة" are the same choice, so every stored answer is
 * matched against the option's stored text and its fr / en / ar translations
 * before it is counted. Host-written questions have one wording only.
 */
import type { RegistrationFormFieldRecord, RegistrationRecord } from '@/server/db/store';

import ar from '@/i18n/messages/ar.json';
import en from '@/i18n/messages/en.json';
import fr from '@/i18n/messages/fr.json';

const CHOICE_TYPES = new Set(['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX']);

type DefaultQuestions = Record<string, string>;
const TRANSLATIONS: DefaultQuestions[] = [
  (fr as { defaultQuestions?: DefaultQuestions }).defaultQuestions ?? {},
  (en as { defaultQuestions?: DefaultQuestions }).defaultQuestions ?? {},
  (ar as { defaultQuestions?: DefaultQuestions }).defaultQuestions ?? {},
];

function norm(s: string): string {
  return s.normalize('NFC').trim().toLocaleLowerCase('fr');
}

export interface ChoiceQuestionSummary {
  fieldId: string;
  label: string;
  labelKey: string | null;
  type: 'DROPDOWN' | 'MULTIPLE_CHOICE' | 'CHECKBOX';
  options: string[];
  optionKeys: string[] | null;
  /** Positionally aligned with `options`. */
  counts: number[];
  /** Answers matching no current option — an option renamed since, say. */
  other: number;
  /** Participants who answered this question at all. */
  answered: number;
}

export interface AnswerSummary {
  /** Confirmed participants — the base every percentage is taken on. */
  confirmed: number;
  questions: ChoiceQuestionSummary[];
}

export function buildAnswerSummary(
  fields: ReadonlyArray<RegistrationFormFieldRecord>,
  registrations: ReadonlyArray<RegistrationRecord>,
): AnswerSummary {
  const confirmed = registrations.filter((r) => r.status === 'CONFIRMED');

  const questions = [...fields]
    .filter((f) => CHOICE_TYPES.has(f.type) && (f.options?.length ?? 0) > 0)
    .sort((a, b) => a.order - b.order)
    .map((f): ChoiceQuestionSummary => {
      const options = f.options ?? [];
      const keys = f.optionKeys ?? null;
      // Every wording each option may have been answered in.
      const wordings = options.map((opt, i) => {
        const set = new Set([norm(opt)]);
        const key = keys?.[i];
        if (key) for (const lang of TRANSLATIONS) if (lang[key]) set.add(norm(lang[key]!));
        return set;
      });

      const counts = options.map(() => 0);
      let other = 0;
      let answered = 0;

      for (const r of confirmed) {
        const raw = r.answers.find((a) => a.fieldId === f.id)?.value;
        const values = (Array.isArray(raw) ? raw : raw != null ? [raw] : [])
          .map((v) => String(v))
          .filter((v) => v.trim() !== '');
        if (values.length === 0) continue;
        answered += 1;
        // A participant ticking the same box twice counts once.
        const seen = new Set<number>();
        for (const v of values) {
          const i = wordings.findIndex((w) => w.has(norm(v)));
          if (i === -1) other += 1;
          else if (!seen.has(i)) { seen.add(i); counts[i]! += 1; }
        }
      }

      return {
        fieldId: f.id,
        label: f.label,
        labelKey: f.labelKey ?? null,
        type: f.type as ChoiceQuestionSummary['type'],
        options,
        optionKeys: keys,
        counts,
        other,
        answered,
      };
    });

  return { confirmed: confirmed.length, questions };
}
