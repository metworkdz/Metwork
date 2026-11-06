/**
 * "Show this question only if…" — the pure rule shared by the public form
 * (skips steps as people answer) and the server (a question never shown is
 * never "missing").
 */
import { describe, it, expect } from 'vitest';
import { isQuestionVisible } from '@/lib/registration-conditions';
import { findMissingRequiredAnswer } from '@/server/registrations/service';

const FIELDS = [
  { id: 'who', order: 0, showWhen: null },
  { id: 'company', order: 1, showWhen: { order: 0, equals: 'Entreprise' } },
  { id: 'days', order: 2, showWhen: null },
];

const answers = (m: Record<string, string | string[]>) => (id: string) => m[id];

describe('isQuestionVisible', () => {
  it('always shows a question with no rule', () => {
    expect(isQuestionVisible(FIELDS[2]!, FIELDS, answers({}))).toBe(true);
  });

  it('hides a dependent question until the unlocking option is chosen', () => {
    expect(isQuestionVisible(FIELDS[1]!, FIELDS, answers({}))).toBe(false);
    expect(isQuestionVisible(FIELDS[1]!, FIELDS, answers({ who: 'Personnel' }))).toBe(false);
    expect(isQuestionVisible(FIELDS[1]!, FIELDS, answers({ who: 'Entreprise' }))).toBe(true);
  });

  it('matches a multi-select answer that includes the option', () => {
    expect(isQuestionVisible(FIELDS[1]!, FIELDS, answers({ who: ['A', 'Entreprise'] }))).toBe(true);
    expect(isQuestionVisible(FIELDS[1]!, FIELDS, answers({ who: ['A'] }))).toBe(false);
  });

  it('a hidden question cannot unlock another', () => {
    const chain = [
      ...FIELDS,
      { id: 'vat', order: 3, showWhen: { order: 1, equals: 'oui' } },
    ];
    // company is hidden (who != Entreprise) even though its own answer says "oui"
    expect(isQuestionVisible(chain[3]!, chain, answers({ who: 'Personnel', company: 'oui' }))).toBe(false);
  });

  it('never hides a question forever on a dangling or forward reference', () => {
    expect(isQuestionVisible({ id: 'x', order: 1, showWhen: { order: 9, equals: 'a' } }, FIELDS, answers({}))).toBe(true);
    expect(isQuestionVisible({ id: 'x', order: 1, showWhen: { order: 1, equals: 'a' } }, FIELDS, answers({}))).toBe(true);
  });
});

describe('findMissingRequiredAnswer with conditional questions', () => {
  const rec = (id: string, order: number, required: boolean, showWhen: unknown = null) => ({
    id, order, required, showWhen, label: id, entityType: 'PROGRAM', entityId: 'p1',
  });
  const data = {
    registrationFormFields: [
      rec('who', 0, true),
      rec('company', 1, true, { order: 0, equals: 'Entreprise' }),
    ],
  } as unknown as Parameters<typeof findMissingRequiredAnswer>[0];

  it('does not demand a required question that was never shown', () => {
    expect(findMissingRequiredAnswer(data, 'PROGRAM', 'p1', [{ fieldId: 'who', value: 'Personnel' }])).toBeNull();
  });

  it('demands it once it applies', () => {
    expect(findMissingRequiredAnswer(data, 'PROGRAM', 'p1', [{ fieldId: 'who', value: 'Entreprise' }]))
      .toMatchObject({ fieldId: 'company' });
    expect(findMissingRequiredAnswer(data, 'PROGRAM', 'p1', [
      { fieldId: 'who', value: 'Entreprise' },
      { fieldId: 'company', value: 'ACME' },
    ])).toBeNull();
  });
});
