/**
 * Registration questions render in the VISITOR's language, not the author's.
 *
 * `buildDefaultApplicationFields` used to resolve the `defaultQuestions` i18n
 * keys once, at program-creation time, and persist only the resulting text. The
 * seeded set was then frozen in whatever locale the host happened to be using:
 * an Arabic visitor read English questions on an otherwise-Arabic page, and
 * editing the message files fixed nothing because the English was already in
 * the database.
 *
 * Fields now carry the key alongside the text. What is pinned here:
 *   1. Seeded fields carry their keys; the public resolver uses them.
 *   2. A host-written question is NEVER template-translated.
 *   3. A missing/blank key degrades to the stored text, never to a raw key.
 *   4. Editing a question drops its key — the host's words win.
 *   5. The backfill matcher recognises legacy fields in any locale, and leaves
 *      anything host-written or edited completely alone.
 *   6. All three message files carry every key the default set names.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_APPLICATION_QUESTIONS,
  buildDefaultApplicationFields,
} from '@/server/programs/default-application-questions';
import {
  questionLabel,
  questionOptions,
  keysSurvivingEdit,
} from '@/lib/registration-question';
import { matchSeededQuestion } from '../../scripts/backfill-registration-form-keys';
import en from '@/i18n/messages/en.json';
import fr from '@/i18n/messages/fr.json';
import ar from '@/i18n/messages/ar.json';

type Dict = Record<string, string>;
const EN = (en as { defaultQuestions: Dict }).defaultQuestions;
const FR = (fr as { defaultQuestions: Dict }).defaultQuestions;
const AR = (ar as { defaultQuestions: Dict }).defaultQuestions;

/** Stand-in for `useTranslations('defaultQuestions')` in one locale. */
const translator = (dict: Dict) => (key: string) => dict[key] ?? key;

/* ─────────────────── The message files actually cover the set ─────────────────── */

describe('the defaultQuestions namespace', () => {
  const keys = DEFAULT_APPLICATION_QUESTIONS.flatMap((q) => [q.labelKey, ...(q.optionKeys ?? [])]);

  for (const [name, dict] of Object.entries({ en: EN, fr: FR, ar: AR })) {
    it(`${name} carries every key the default question set names`, () => {
      const missing = keys.filter((k) => !dict[k]?.trim());
      expect(missing, `missing ${name} keys`).toEqual([]);
    });
  }

  it('renders the same question differently per locale', () => {
    expect(EN.startupName).not.toBe(FR.startupName);
    expect(EN.startupName).not.toBe(AR.startupName);
    // Arabic must actually be Arabic, not an untranslated copy.
    expect(AR.startupName).toMatch(/[؀-ۿ]/);
  });
});

/* ─────────────────────────── Seeding carries the keys ─────────────────────────── */

describe('buildDefaultApplicationFields', () => {
  it('emits the key alongside the resolved text, so nothing is frozen', () => {
    const fields = buildDefaultApplicationFields(translator(EN));
    expect(fields).toHaveLength(DEFAULT_APPLICATION_QUESTIONS.length);
    for (const f of fields) expect(f.labelKey).toBeTruthy();

    const startup = fields.find((f) => f.labelKey === 'startupName')!;
    expect(startup.label).toBe(EN.startupName);

    const stage = fields.find((f) => f.labelKey === 'stage')!;
    expect(stage.optionKeys).toEqual(['stageIdea', 'stagePrototype', 'stageRevenue', 'stageGrowth']);
    expect(stage.options).toEqual(stage.optionKeys!.map((k) => EN[k]));
  });

  it('leaves optionKeys null on a non-choice question', () => {
    const fields = buildDefaultApplicationFields(translator(EN));
    expect(fields.find((f) => f.labelKey === 'motivation')!.optionKeys).toBeNull();
  });
});

/* ──────────────── A field seeded in one locale reads in another ──────────────── */

describe('questionLabel / questionOptions', () => {
  /** Exactly what the store holds after an English-authoring host seeds it. */
  const seededInEnglish = (() => {
    const f = buildDefaultApplicationFields(translator(EN)).find((x) => x.labelKey === 'stage')!;
    return { label: f.label, labelKey: f.labelKey, options: f.options, optionKeys: f.optionKeys };
  })();

  it('renders an English-seeded question in Arabic for an Arabic visitor', () => {
    expect(seededInEnglish.label).toBe(EN.stage!);
    expect(questionLabel(seededInEnglish, translator(AR))).toBe(AR.stage);
    expect(questionOptions(seededInEnglish, translator(AR))).toEqual([
      AR.stageIdea!, AR.stagePrototype!, AR.stageRevenue!, AR.stageGrowth!,
    ]);
  });

  it('renders the same question in French for a French visitor', () => {
    expect(questionLabel(seededInEnglish, translator(FR))).toBe(FR.stage);
  });

  it('NEVER translates a question the host wrote themselves', () => {
    const hostWritten = {
      label: 'Combien de co-fondateurs êtes-vous ?',
      labelKey: null,
      options: ['1', '2', '3+'],
      optionKeys: null,
    };
    expect(questionLabel(hostWritten, translator(AR))).toBe(hostWritten.label);
    expect(questionOptions(hostWritten, translator(AR))).toEqual(hostWritten.options);
  });

  it('falls back to the stored text rather than showing a raw key', () => {
    // next-intl echoes an unknown key back; that must never reach an applicant.
    const echo = (key: string) => key;
    const field = { label: 'Stored wording', labelKey: 'notAKey', options: null, optionKeys: null };
    expect(questionLabel(field, echo)).toBe('Stored wording');
  });

  it('degrades one option at a time when only some keys resolve', () => {
    const partial = {
      label: 'Stage',
      labelKey: 'stage',
      options: ['Idea', 'Custom choice'],
      optionKeys: ['stageIdea', 'notAKey'],
    };
    expect(questionOptions(partial, translator(AR))).toEqual([AR.stageIdea!, 'Custom choice']);
  });

  it('leaves options untouched when the field carries no option keys', () => {
    const field = { label: 'X', labelKey: 'stage', options: ['a', 'b'], optionKeys: null };
    expect(questionOptions(field, translator(AR))).toEqual(['a', 'b']);
  });
});

/* ─────────────────────────── Editing wins over the template ─────────────────────────── */

describe('keysSurvivingEdit', () => {
  const original = {
    label: EN.stage!,
    labelKey: 'stage',
    options: [EN.stageIdea!, EN.stagePrototype!],
    optionKeys: ['stageIdea', 'stagePrototype'],
  };

  it('keeps the keys when nothing changed', () => {
    expect(keysSurvivingEdit(original, { label: EN.stage!, options: [...original.options] }))
      .toEqual({ labelKey: 'stage', optionKeys: ['stageIdea', 'stagePrototype'] });
  });

  it('drops the label key the moment the host rewords the question', () => {
    const out = keysSurvivingEdit(original, {
      label: 'Stage (be specific)',
      options: [...original.options],
    });
    expect(out.labelKey).toBeNull();
    // The options were untouched, so THEIR keys survive independently.
    expect(out.optionKeys).toEqual(['stageIdea', 'stagePrototype']);
  });

  it('drops the option keys when a choice is edited, added or removed', () => {
    expect(keysSurvivingEdit(original, { label: EN.stage!, options: [EN.stageIdea!] }).optionKeys)
      .toBeNull();
    expect(keysSurvivingEdit(original, { label: EN.stage!, options: [EN.stageIdea!, 'Scaling up'] }).optionKeys)
      .toBeNull();
  });

  it('restores the keys when the host reverts their edit', () => {
    expect(keysSurvivingEdit(original, { label: EN.stage!, options: [...original.options] }).labelKey)
      .toBe('stage');
  });

  it('treats a brand-new field as host-written', () => {
    expect(keysSurvivingEdit(undefined, { label: 'Anything', options: [] }))
      .toEqual({ labelKey: null, optionKeys: null });
  });
});

/* ─────────────────────────── The backfill matcher ─────────────────────────── */

describe('matchSeededQuestion (backfill)', () => {
  it('recognises a legacy English field', () => {
    // Verbatim from the pre-fix production document.
    expect(matchSeededQuestion({ label: 'Startup / project name', type: 'SHORT_TEXT' }))
      .toMatchObject({ labelKey: 'startupName', locale: 'en' });
  });

  it('recognises a legacy field authored in French or Arabic', () => {
    expect(matchSeededQuestion({ label: FR.startupName!, type: 'SHORT_TEXT' }))
      .toMatchObject({ labelKey: 'startupName', locale: 'fr' });
    expect(matchSeededQuestion({ label: AR.startupName!, type: 'SHORT_TEXT' }))
      .toMatchObject({ labelKey: 'startupName', locale: 'ar' });
  });

  it('matches a choice field only when its options match too', () => {
    const options = ['stageIdea', 'stagePrototype', 'stageRevenue', 'stageGrowth'].map((k) => EN[k]!);
    expect(matchSeededQuestion({ label: EN.stage!, type: 'DROPDOWN', options }))
      .toMatchObject({ labelKey: 'stage', optionKeys: ['stageIdea', 'stagePrototype', 'stageRevenue', 'stageGrowth'] });

    // One choice removed → the host edited it, so it stays theirs.
    expect(matchSeededQuestion({ label: EN.stage!, type: 'DROPDOWN', options: options.slice(0, 3) }))
      .toBeNull();
    // One choice reworded → likewise.
    expect(matchSeededQuestion({
      label: EN.stage!,
      type: 'DROPDOWN',
      options: [...options.slice(0, 3), 'Scaling hard'],
    })).toBeNull();
  });

  it('leaves a host-written question alone', () => {
    expect(matchSeededQuestion({ label: 'Combien de co-fondateurs ?', type: 'SHORT_TEXT' })).toBeNull();
  });

  it('leaves an edited seeded question alone', () => {
    expect(matchSeededQuestion({ label: 'Startup / project name (required)', type: 'SHORT_TEXT' }))
      .toBeNull();
  });

  it('does not match across field types', () => {
    // Same wording, wrong type — not the seeded question.
    expect(matchSeededQuestion({ label: 'Startup / project name', type: 'LONG_TEXT' })).toBeNull();
  });

  it('tolerates only whitespace differences, nothing semantic', () => {
    expect(matchSeededQuestion({ label: '  Startup / project name  ', type: 'SHORT_TEXT' }))
      .toMatchObject({ labelKey: 'startupName' });
  });

  it('round-trips: every seeded question is re-matchable from its own text', () => {
    for (const dict of [EN, FR, AR]) {
      for (const q of DEFAULT_APPLICATION_QUESTIONS) {
        const match = matchSeededQuestion({
          label: dict[q.labelKey]!,
          type: q.type,
          options: q.optionKeys ? q.optionKeys.map((k) => dict[k]!) : null,
        });
        expect(match?.labelKey, `${q.labelKey} should re-match`).toBe(q.labelKey);
      }
    }
  });
});
