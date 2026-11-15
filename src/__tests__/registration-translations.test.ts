/**
 * A host-written question shown in each visitor's language.
 *
 * The rule everything hangs on: translations are for DISPLAY. A visitor who picks
 * "Oui" is recorded as the host's own "Yes", so counts, "ask only if" rules and
 * exports never split by the language someone browsed in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import {
  dropDraftedTranslations,
  normalizeTranslations,
  translatedLocales,
} from '@/lib/registration-translations';
import { questionChoices, questionLabel, questionOptions } from '@/lib/registration-question';
import { draftFormTranslations, type Translator } from '@/server/registrations/translate';
import { handleTranslateForm } from '@/server/registrations/translate-route';
import { isQuestionVisible } from '@/lib/registration-conditions';
import {
  SOURCE_LOCALE,
  TRANSLATION_DRAFTED,
  innovationBridgeFields,
} from '../../scripts/forms/innovation-bridge-algeria';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'u', email: 'inc@x.dz', role: 'INCUBATOR', approvalStatus: 'APPROVED' } });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok), requireApiSession: vi.fn(ok) };
});
vi.mock('@/server/mentors/access', () => ({ requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'm1' })) }));

import { POST as incubatorSave } from '@/app/api/incubator/registration-form/route';
import { POST as consultantSave } from '@/app/api/consultant/registration-form/route';
import { POST as incubatorTranslate } from '@/app/api/incubator/registration-form/translate/route';
import { POST as consultantTranslate } from '@/app/api/consultant/registration-form/translate/route';
import { listFormFields } from '@/server/registrations/service';

const noKey = (k: string) => { throw new Error(`missing ${k}`); };

const yesNo = {
  label: 'Are you available?',
  options: ['Yes', 'No'],
  translations: {
    fr: { label: 'Êtes-vous disponible ?', options: ['Oui', 'Non'] },
    ar: { label: 'هل أنت متاح؟', options: ['نعم', 'لا'] },
  },
};

describe('what a visitor is shown', () => {
  it('their own language when the host translated it', () => {
    expect(questionLabel(yesNo, noKey, 'fr')).toBe('Êtes-vous disponible ?');
    expect(questionLabel(yesNo, noKey, 'ar')).toBe('هل أنت متاح؟');
    expect(questionOptions(yesNo, noKey, 'fr')).toEqual(['Oui', 'Non']);
  });
  it('the host\'s own words when there is no translation for their language', () => {
    expect(questionLabel(yesNo, noKey, 'en')).toBe('Are you available?');
    expect(questionOptions(yesNo, noKey, 'en')).toEqual(['Yes', 'No']);
    expect(questionLabel({ label: 'Plain' }, noKey, 'fr')).toBe('Plain');
  });
  it('the host\'s words on the owner\'s own screens (no locale given)', () => {
    expect(questionLabel(yesNo, noKey)).toBe('Are you available?');
    expect(questionOptions(yesNo, noKey)).toEqual(['Yes', 'No']);
  });
  it('the source choices when a translation of them does not line up — never a guess', () => {
    const bad = { ...yesNo, translations: { fr: { label: 'X', options: ['Oui'] } } };
    expect(questionOptions(bad, noKey, 'fr')).toEqual(['Yes', 'No']);
    expect(questionLabel(bad, noKey, 'fr')).toBe('X'); // the label can still be translated
  });
  it('a seeded question still localizes through its key, ahead of any translation', () => {
    const seeded = { label: 'Stage', labelKey: 'stage', options: ['Idea'], optionKeys: ['idea'], translations: { fr: { label: 'NOPE' } } };
    const tr = (k: string) => (k === 'stage' ? 'Stade' : k === 'idea' ? 'Idée' : noKey(k));
    expect(questionLabel(seeded, tr, 'fr')).toBe('Stade');
    expect(questionOptions(seeded, tr, 'fr')).toEqual(['Idée']);
  });
});

describe('what is RECORDED when a choice is picked', () => {
  it('is the host\'s own option, whatever language it was shown in', () => {
    const fr = questionChoices(yesNo, noKey, 'fr')!;
    const ar = questionChoices(yesNo, noKey, 'ar')!;
    expect(fr).toEqual([{ value: 'Yes', label: 'Oui' }, { value: 'No', label: 'Non' }]);
    expect(ar.map((c) => c.value)).toEqual(['Yes', 'No']);
    expect(ar.map((c) => c.label)).toEqual(['نعم', 'لا']);
  });
  it('so an "ask only if … = Yes" rule matches an answer given in any language', () => {
    const fields = [{ id: 'a', order: 0, showWhen: null }, { id: 'b', order: 1, showWhen: { order: 0, equals: 'Yes' } }];
    for (const locale of ['en', 'fr', 'ar']) {
      const picked = questionChoices(yesNo, noKey, locale)![0]!.value;
      expect(isQuestionVisible(fields[1]!, fields, (id) => (id === 'a' ? picked : undefined))).toBe(true);
    }
  });
  it('keeps the long-standing behaviour for seeded questions (the shown text is recorded)', () => {
    const seeded = { label: 'Stage', labelKey: 'stage', options: ['Idea'], optionKeys: ['idea'] };
    const tr = (k: string) => (k === 'idea' ? 'Idée' : k === 'stage' ? 'Stade' : noKey(k));
    expect(questionChoices(seeded, tr, 'fr')).toEqual([{ value: 'Idée', label: 'Idée' }]);
  });
  it('has no choices for a non-choice question', () => {
    expect(questionChoices({ label: 'Name' }, noKey, 'fr')).toBeNull();
  });
});

describe('normalizeTranslations', () => {
  const base = { type: 'MULTIPLE_CHOICE', options: ['Yes', 'No'] };
  it('keeps aligned translations and trims them', () => {
    const out = normalizeTranslations({ fr: { label: ' Disponible ? ', options: [' Oui', 'Non '] } }, base);
    expect(out.translations).toEqual({ fr: { label: 'Disponible ?', options: ['Oui', 'Non'] } });
  });
  it('drops just the choices of a language whose list does not line up, keeping its label', () => {
    const out = normalizeTranslations({ fr: { label: 'Q', options: ['Oui'] } }, base);
    expect(out.translations).toEqual({ fr: { label: 'Q' } });
  });
  it('drops choices that contain a blank line', () => {
    expect(normalizeTranslations({ fr: { options: ['Oui', ' '] } }, base).translations).toBeNull();
  });
  it('removes a language with nothing in it, and forgets its draft flag', () => {
    const out = normalizeTranslations({ fr: { label: '' }, ar: { label: 'س' } }, base, ['fr', 'ar']);
    expect(out.translations).toEqual({ ar: { label: 'س' } });
    expect(out.drafted).toEqual(['ar']);
  });
  it('ignores choices on a question that has none', () => {
    expect(normalizeTranslations({ fr: { label: 'Nom', options: ['x'] } }, { type: 'SHORT_TEXT', options: null }).translations)
      .toEqual({ fr: { label: 'Nom' } });
  });
  it('returns nulls when there is nothing to keep', () => {
    expect(normalizeTranslations(null, base)).toEqual({ translations: null, drafted: null });
  });
  it('bounds an over-long text', () => {
    const out = normalizeTranslations({ fr: { label: 'x'.repeat(500) } }, base);
    expect(out.translations!.fr!.label).toHaveLength(200);
  });
});

describe('machine drafts go stale when the source wording changes', () => {
  it('drops drafts, keeps what a person wrote or checked', () => {
    const out = dropDraftedTranslations({ fr: { label: 'brouillon' }, ar: { label: 'مراجَع' } }, ['fr']);
    expect(out.translations).toEqual({ ar: { label: 'مراجَع' } });
    expect(translatedLocales(out.translations)).toEqual(['ar']);
  });
  it('can leave nothing', () => {
    expect(dropDraftedTranslations({ fr: { label: 'x' } }, ['fr']).translations).toBeNull();
  });
});

/* ───────────────────────── Save routes ───────────────────────── */

const INC = 'inc-tr';
const EVENT = '11111111-1111-4111-8111-111111111111';
const PROGRAM = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [{ id: INC, managerId: 'u', name: 'Hub', status: 'ACTIVE', email: 'inc@x.dz' } as never];
    d.events = [{ id: EVENT, incubatorId: INC, title: 'E', isActive: true }] as never;
    d.programs = [{ id: PROGRAM, incubatorId: null, mentorId: 'm1', title: 'P', isActive: true, createdAt: NOW, updatedAt: NOW }] as never;
    d.registrationFormFields = []; d.registrations = [];
  });
});

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const choice = (over: Record<string, unknown> = {}) => ({
  label: yesNo.label, type: 'MULTIPLE_CHOICE', options: yesNo.options, required: true, order: 0,
  sourceLocale: 'en', translations: yesNo.translations, draftedLocales: ['fr'], ...over,
});
const saveI = (f: unknown[]) => incubatorSave(post('/api/incubator/registration-form', { entityType: 'EVENT', entityId: EVENT, fields: f }));
const saveC = (f: unknown[]) => consultantSave(post('/api/consultant/registration-form', { entityId: PROGRAM, fields: f }));

describe.each([['incubator', saveI, 'EVENT', EVENT], ['consultant', saveC, 'PROGRAM', PROGRAM]] as const)(
  '%s save route: translations',
  (_who, save, type, id) => {
    it('stores the source language, the translations and which are drafts', async () => {
      expect((await save([choice()])).status).toBe(200);
      const [f] = await listFormFields(type, id);
      expect(f!.sourceLocale).toBe('en');
      expect(f!.translations).toEqual(yesNo.translations);
      expect(f!.draftedLocales).toEqual(['fr']);
    });
    it('drops a language\'s choices that do not line up, keeping the rest', async () => {
      await save([choice({ translations: { fr: { label: 'Q', options: ['Oui'] }, ar: yesNo.translations.ar }, draftedLocales: null })]);
      const [f] = await listFormFields(type, id);
      expect(f!.translations).toEqual({ fr: { label: 'Q' }, ar: yesNo.translations.ar });
    });
    it('forgets a draft flag for a language that holds nothing', async () => {
      await save([choice({ translations: { ar: yesNo.translations.ar }, draftedLocales: ['fr', 'ar'] })]);
      expect((await listFormFields(type, id))[0]!.draftedLocales).toEqual(['ar']);
    });
    it('stores nothing extra for a question without translations', async () => {
      await save([choice({ translations: undefined, draftedLocales: undefined })]);
      const [f] = await listFormFields(type, id);
      expect(f!.translations).toBeNull();
      expect(f!.draftedLocales).toBeNull();
    });
    it('rejects an unknown language', async () => {
      expect((await save([choice({ sourceLocale: 'de' })])).status).toBe(422);
      expect((await save([choice({ translations: { de: { label: 'x' } } })])).status).toBe(200); // unknown keys are ignored, not stored
      expect((await listFormFields(type, id))[0]!.translations).toBeNull();
    });
    it('a re-save keeps the question id and its translations', async () => {
      const first = (await (await save([choice()])).json()).fields[0].id as string;
      const again = await (await save([choice({ id: first })])).json();
      expect(again.fields[0].id).toBe(first);
      expect((await listFormFields(type, id))[0]!.translations).toEqual(yesNo.translations);
    });
  },
);

/* ───────────────────────── Drafting with the model ───────────────────────── */

describe('draftFormTranslations', () => {
  /** A translator that "translates" by tagging, and records what it was asked. */
  const seen: Array<{ source: string; keys: string[] }> = [];
  const tagging: Translator = async (source, items) => {
    seen.push({ source, keys: items.map((i) => i.key) });
    return new Map(items.map((it) => [it.key, Object.fromEntries(it.targets.map((l) => [l, `[${l}] ${it.text}`]))]));
  };
  beforeEach(() => { seen.length = 0; });

  it('drafts only the requested languages, for labels and choices', async () => {
    const r = await draftFormTranslations('en', [
      { label: 'Available?', options: ['Yes', 'No'], targets: ['fr', 'ar'] },
      { label: 'Name', targets: ['fr'] },
    ], tagging);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields[0]).toEqual({
      fr: { label: '[fr] Available?', options: ['[fr] Yes', '[fr] No'] },
      ar: { label: '[ar] Available?', options: ['[ar] Yes', '[ar] No'] },
    });
    expect(r.fields[1]).toEqual({ fr: { label: '[fr] Name' } });
  });
  it('never drafts the source language', async () => {
    const r = await draftFormTranslations('fr', [{ label: 'Nom', targets: ['fr', 'en'] }], tagging);
    expect(r.ok && r.fields[0]).toEqual({ en: { label: '[en] Nom' } });
  });
  it('sends nothing when nothing is wanted', async () => {
    const r = await draftFormTranslations('en', [{ label: 'x', targets: ['en'] }], tagging);
    expect(r.ok && r.fields).toEqual([{}]);
    expect(seen).toHaveLength(0);
  });
  it('splits a long list into several requests', async () => {
    const options = Array.from({ length: 140 }, (_, i) => `Option ${i}`);
    await draftFormTranslations('en', [{ label: 'Long', options, targets: ['fr'] }], tagging);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.flatMap((s) => s.keys)).toHaveLength(141);
  });
  it('returns a label alone, and choices only as a complete set', async () => {
    const partial: Translator = async (_s, items) => new Map(
      items.filter((i) => i.key !== 'f0:o1').map((it) => [it.key, { fr: `[fr] ${it.text}` }]),
    );
    const r = await draftFormTranslations('en', [{ label: 'Q', options: ['A', 'B'], targets: ['fr'] }], partial);
    expect(r.ok && r.fields[0]).toEqual({ fr: { label: '[fr] Q' } });
  });
  it('ignores answers for keys it did not ask about', async () => {
    const sneaky: Translator = async (_s, items) => new Map([
      ...items.map((it) => [it.key, { fr: `[fr] ${it.text}` }] as const),
      ['f9:label', { fr: 'injected' }],
    ]);
    const r = await draftFormTranslations('en', [{ label: 'Q', targets: ['fr'] }], sneaky);
    expect(r.ok && r.fields).toEqual([{ fr: { label: '[fr] Q' } }]);
  });
  it('bounds what comes back', async () => {
    const long: Translator = async (_s, items) => new Map(items.map((it) => [it.key, { fr: 'y'.repeat(900) }]));
    const r = await draftFormTranslations('en', [{ label: 'Q', targets: ['fr'] }], long);
    expect(r.ok && r.fields[0]!.fr!.label).toHaveLength(200);
  });
  it('reports "unavailable" and "failed" as such', async () => {
    const off: Translator = async () => { throw new Error('TRANSLATION_UNAVAILABLE'); };
    const broken: Translator = async () => { throw new Error('boom'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await draftFormTranslations('en', [{ label: 'Q', targets: ['fr'] }], off)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await draftFormTranslations('en', [{ label: 'Q', targets: ['fr'] }], broken)).toEqual({ ok: false, code: 'FAILED' });
    spy.mockRestore();
  });
});

describe('POST …/registration-form/translate', () => {
  const body = { sourceLocale: 'en', fields: [{ label: 'Available?', options: ['Yes', 'No'], targets: ['fr', 'ar'] }] };
  const call = (b: unknown, key = `k-${Math.random()}`, translator?: Translator) =>
    handleTranslateForm(post('/api/x', b), key, translator);
  const echo: Translator = async (_s, items) => new Map(items.map((it) => [it.key, { fr: `fr ${it.text}`, ar: `ar ${it.text}` }]));

  it('answers with one set of drafts per question, and stores nothing', async () => {
    const res = await call(body, undefined, echo);
    expect(res.status).toBe(200);
    expect((await res.json()).fields[0].fr.label).toBe('fr Available?');
    expect((await db.read()).registrationFormFields).toHaveLength(0);
  });
  it('refuses a malformed or oversize request', async () => {
    expect((await call({ sourceLocale: 'de', fields: body.fields })).status).toBe(422);
    expect((await call({ sourceLocale: 'en', fields: [] })).status).toBe(422);
    expect((await call({ sourceLocale: 'en', fields: Array.from({ length: 31 }, () => ({ label: 'x', targets: ['fr'] })) })).status).toBe(422);
    expect((await call({ sourceLocale: 'en', fields: [{ label: 'x'.repeat(201), targets: ['fr'] }] })).status).toBe(422);
    expect((await call({ sourceLocale: 'en', fields: [{ label: 'x', targets: [] }] })).status).toBe(422);
  });
  it('is rate limited per person (it spends money)', async () => {
    const key = `limit-${Math.random()}`;
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await call(body, key, echo)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
  it('says so, with a 503, when no model key is configured (the real path, no mock)', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await incubatorTranslate(post('/api/incubator/registration-form/translate', body));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('TRANSLATION_UNAVAILABLE');
      expect((await consultantTranslate(post('/api/consultant/registration-form/translate', body))).status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

/* ───────────────────────── The Innovation Bridge translations ───────────────────────── */

describe('Innovation Bridge Algeria — translations', () => {
  const fields = innovationBridgeFields;

  it('is written in English and flags French and Arabic as unreviewed drafts', () => {
    expect(SOURCE_LOCALE).toBe('en');
    expect(TRANSLATION_DRAFTED).toEqual(['fr', 'ar']);
  });
  it('translates every question into French and Arabic', () => {
    for (const f of fields) {
      expect(f.translations.fr?.label?.trim(), `fr: ${f.label}`).toBeTruthy();
      expect(f.translations.ar?.label?.trim(), `ar: ${f.label}`).toBeTruthy();
    }
  });
  it('translates every choice, one-for-one and in order', () => {
    for (const f of fields) {
      if (!f.options) continue;
      for (const l of ['fr', 'ar'] as const) {
        expect(f.translations[l]?.options, `${l}: ${f.label}`).toHaveLength(f.options.length);
      }
    }
  });
  it('survives the same normalisation the server applies — nothing is dropped', () => {
    for (const f of fields) {
      const out = normalizeTranslations(f.translations, { type: f.type, options: f.options }, TRANSLATION_DRAFTED);
      expect(out.translations, f.label).toEqual(Object.fromEntries(
        Object.entries(f.translations).map(([l, t]) => [l, { ...(t.label ? { label: t.label } : {}), ...(t.options ? { options: t.options } : {}) }]),
      ));
    }
  });
  it('writes the Arabic in Arabic script, keeping brand names and acronyms in Latin letters', () => {
    for (const f of fields) {
      expect(f.translations.ar!.label, f.label).toMatch(/[؀-ۿ]/);
    }
    const labelled = fields.find((f) => f.label.startsWith('Is your startup'))!;
    expect(labelled.translations.ar!.options!.slice(0, 2)).toEqual(['Label Startup', 'Label Projet Innovant']);
  });
  it('gives the wilayas their official French, Arabic and English names', () => {
    const w = fields[0]!;
    expect(w.translations.ar!.options![15]).toBe('الجزائر');
    expect(w.translations.fr!.options![5]).toBe('Béjaïa');
    expect(w.translations.en!.options![5]).toBe('Bejaia');
    expect(w.options![5]).toBe('Béjaïa'); // the stored value is the French name
  });
  it('keeps every label and choice within the save limit', () => {
    for (const f of fields) for (const t of Object.values(f.translations)) {
      expect((t.label ?? '').length).toBeLessThanOrEqual(200);
      for (const o of t.options ?? []) expect(o.length).toBeLessThanOrEqual(200);
    }
  });
  it('is accepted by the save route in full', async () => {
    const res = await saveI(fields.map((f, i) => ({
      label: f.label, type: f.type, options: f.options ?? null, required: f.required, order: i,
      sourceLocale: SOURCE_LOCALE, translations: f.translations,
      draftedLocales: TRANSLATION_DRAFTED.filter((l) => f.translations[l]),
    })));
    expect(res.status).toBe(200);
    const stored = await listFormFields('EVENT', EVENT);
    expect(stored).toHaveLength(fields.length);
    // every translation survived storing…
    expect(stored.every((s) => translatedLocales(s.translations).includes('fr') && translatedLocales(s.translations).includes('ar'))).toBe(true);
    // …and a French visitor sees French, but the recorded answer is the English option.
    const stage = stored.find((s) => s.label === 'What stage is your solution at?')!;
    expect(questionLabel(stage, noKey, 'fr')).toBe('À quel stade se trouve votre solution ?');
    expect(questionChoices(stage, noKey, 'fr')![2]).toEqual({ value: 'Tested solution', label: 'Solution testée' });
  });
});
