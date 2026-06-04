/**
 * Default application-form question set for NEW programs.
 *
 * This is a pure, framework-agnostic data module (no server-only imports) so it
 * can be consumed from both the incubator dialog (client) and any server code.
 *
 * Labels and dropdown options are stored as **translation keys** (under the
 * `defaultQuestions` i18n namespace), not literal strings — `buildDefaultApplicationFields`
 * resolves them with a caller-supplied `translate` fn so the seeded questions
 * localize to whatever locale the incubator is authoring in.
 *
 * The set is intentionally limited to *custom* questions. Full name, email and
 * phone are collected by the registration form's built-in identity section, so
 * re-adding them here would duplicate those inputs.
 */
import type { RegistrationFieldType } from '@/types/domain';

export interface DefaultQuestion {
  /** Key under the `defaultQuestions` namespace, e.g. 'startupName'. */
  labelKey: string;
  type: RegistrationFieldType;
  required: boolean;
  /** Keys (same namespace) for DROPDOWN / choice options, in display order. */
  optionKeys?: string[];
}

/** A field shaped for the registration-form API / builder. */
export interface BuiltDefaultField {
  label: string;
  type: RegistrationFieldType;
  options: string[] | null;
  required: boolean;
  order: number;
}

/**
 * The default questions, grouped logically. Order here is the order shown.
 */
export const DEFAULT_APPLICATION_QUESTIONS: DefaultQuestion[] = [
  // ── Entrepreneur info (name/email/phone are built-in) ──
  { labelKey: 'city', type: 'SHORT_TEXT', required: false },

  // ── Startup / project info ──
  { labelKey: 'startupName', type: 'SHORT_TEXT', required: true },
  {
    labelKey: 'stage',
    type: 'DROPDOWN',
    required: true,
    optionKeys: ['stageIdea', 'stagePrototype', 'stageRevenue', 'stageGrowth'],
  },
  {
    labelKey: 'sector',
    type: 'DROPDOWN',
    required: false,
    optionKeys: [
      'sectorTech',
      'sectorAgritech',
      'sectorFintech',
      'sectorHealth',
      'sectorEcommerce',
      'sectorEducation',
      'sectorEnergy',
      'sectorOther',
    ],
  },
  { labelKey: 'website', type: 'URL', required: false },
  { labelKey: 'description', type: 'LONG_TEXT', required: true },

  // ── Attachments (links — the public form supports guests, and the existing
  //    upload path is authenticated + image-only, so we collect URLs) ──
  { labelKey: 'mvpLink', type: 'URL', required: false },
  { labelKey: 'pitchDeck', type: 'URL', required: false },

  // ── Motivation ──
  { labelKey: 'motivation', type: 'LONG_TEXT', required: true },
  { labelKey: 'outcomes', type: 'LONG_TEXT', required: false },
];

/**
 * Resolve the default template into concrete fields using a translate fn
 * (typically `useTranslations('defaultQuestions')` on the client).
 */
export function buildDefaultApplicationFields(
  translate: (key: string) => string,
): BuiltDefaultField[] {
  return DEFAULT_APPLICATION_QUESTIONS.map((q, i) => ({
    label: translate(q.labelKey),
    type: q.type,
    options: q.optionKeys ? q.optionKeys.map((k) => translate(k)) : null,
    required: q.required,
    order: i,
  }));
}
