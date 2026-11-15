/**
 * Things found by building a real 20-question application (Innovation Bridge
 * Algeria) in the form builder: a 58-wilaya dropdown cannot be pasted, duplicate
 * choices were accepted, a multi-select with commas in its choices was
 * unreadable in the table and the CSV, and the answer summary drew 57 empty
 * bars. Each has a regression test here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import {
  MAX_FORM_FIELDS,
  cleanOptions,
  findDuplicateOption,
  formatAnswerValue,
  insertPastedOptions,
  visibleSummaryRows,
} from '@/lib/registration-options';
import { algerianCities } from '@/config/cities';
import { innovationBridgeFields } from '../../scripts/forms/innovation-bridge-algeria';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'u', email: 'inc@x.dz', role: 'INCUBATOR', approvalStatus: 'APPROVED' } });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok), requireApiSession: vi.fn(ok) };
});
vi.mock('@/server/mentors/access', () => ({ requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'm1' })) }));

import { POST as incubatorSave } from '@/app/api/incubator/registration-form/route';
import { POST as consultantSave } from '@/app/api/consultant/registration-form/route';
import { buildRegistrationsCsv, incubatorScope, listFormFields } from '@/server/registrations/service';

describe('insertPastedOptions', () => {
  it('turns each pasted line into its own choice', () => {
    expect(insertPastedOptions([''], 0, 'Alpha\nBeta\r\nGamma\n').options).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
  it('replaces the empty box it was pasted into, and inserts after a filled one', () => {
    expect(insertPastedOptions(['A', '', 'Z'], 1, 'B\nC').options).toEqual(['A', 'B', 'C', 'Z']);
    expect(insertPastedOptions(['A', 'Z'], 0, 'B\nC').options).toEqual(['A', 'B', 'C', 'Z']);
  });
  it('skips lines already in the list and blank lines', () => {
    expect(insertPastedOptions(['Alpha'], 0, '\n alpha \nBeta\n\n').options).toEqual(['Alpha', 'Beta']);
  });
  it('focuses the last pasted choice', () => {
    expect(insertPastedOptions([''], 0, 'A\nB\nC').focus).toBe(2);
  });
  it('takes all 58 wilayas in one paste', () => {
    const list = algerianCities.map((c) => c.nameFr).join('\n');
    const out = insertPastedOptions([''], 0, list).options;
    expect(out).toHaveLength(58);
    expect(out[15]).toBe('Alger');
  });
  it('changes nothing when every pasted line is a duplicate', () => {
    expect(insertPastedOptions(['A'], 0, 'a').options).toEqual(['A']);
  });
});

describe('choices', () => {
  it('cleans spaces and blanks', () => {
    expect(cleanOptions([' A ', '', '  ', 'B'])).toEqual(['A', 'B']);
  });
  it('finds a duplicate regardless of case and spaces', () => {
    expect(findDuplicateOption(['Alpha', 'Beta', 'alpha '])).toBe('alpha');
    expect(findDuplicateOption(['Alpha', 'Beta'])).toBeNull();
    expect(findDuplicateOption(['Été', 'été'])).toBe('été');
  });
});

describe('multi-select answers are written so choices with commas stay readable', () => {
  it('uses a separator the choices cannot contain', () => {
    const v = ['Quality, HSE & Compliance', 'FoodTech & Agritech', 'Energy, Environment & Sustainability'];
    const out = formatAnswerValue(v);
    expect(out).toBe('Quality, HSE & Compliance; FoodTech & Agritech; Energy, Environment & Sustainability');
    expect(out.split('; ')).toEqual(v);
  });
  it('leaves a single value alone', () => {
    expect(formatAnswerValue('Oran')).toBe('Oran');
  });
});

describe('visibleSummaryRows', () => {
  const rows = (n: number, picked: number[]) => Array.from({ length: n }, (_, i) => ({ label: `o${i}`, count: picked.includes(i) ? 1 : 0 }));
  it('shows a short list in full, zeros included', () => {
    const r = visibleSummaryRows(rows(6, [0]));
    expect(r.rows).toHaveLength(6);
    expect(r.hidden).toBe(0);
  });
  it('shows only the picked options of a long list and counts the rest', () => {
    const r = visibleSummaryRows(rows(58, [3, 20]));
    expect(r.rows.map((x) => x.label)).toEqual(['o3', 'o20']);
    expect(r.hidden).toBe(56);
  });
  it('shows everything when asked', () => {
    expect(visibleSummaryRows(rows(58, [3]), { showAll: true }).rows).toHaveLength(58);
  });
});

/* ───────────────────────── Save routes ───────────────────────── */

const INC = 'inc-opt';
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
const q = (over: Record<string, unknown>) => ({ label: 'Q', type: 'DROPDOWN', options: ['A', 'B'], required: false, order: 0, ...over });
const saveI = (fields: unknown[]) => incubatorSave(post('/api/incubator/registration-form', { entityType: 'EVENT', entityId: EVENT, fields }));
const saveC = (fields: unknown[]) => consultantSave(post('/api/consultant/registration-form', { entityId: PROGRAM, fields }));

describe.each([['incubator', saveI], ['consultant', saveC]] as const)('%s save route: choices', (_who, save) => {
  it('refuses a duplicate choice, ignoring case and spaces, with a readable message', async () => {
    const res = await save([q({ label: 'Stage', options: ['MVP', 'mvp '] })]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_OPTIONS');
    expect(body.error.message).toContain('Stage');
    expect(body.error.message).toContain('mvp');
  });
  it('refuses a choice question with no choices', async () => {
    expect((await (await save([q({ options: [] })])).json()).error.code).toBe('OPTIONS_REQUIRED');
  });
  it('stores choices trimmed', async () => {
    expect((await save([q({ options: [' Idea', 'MVP  '] })])).status).toBe(200);
    const stored = (await db.read()).registrationFormFields[0]!;
    expect(stored.options).toEqual(['Idea', 'MVP']);
  });
  it('refuses a form over the question limit', async () => {
    const res = await save(Array.from({ length: MAX_FORM_FIELDS + 1 }, (_, i) => q({ label: `Q${i}`, type: 'SHORT_TEXT', options: null, order: i })));
    expect(res.status).toBe(422);
  });
  it('accepts a form of exactly the limit', async () => {
    const res = await save(Array.from({ length: MAX_FORM_FIELDS }, (_, i) => q({ label: `Q${i}`, type: 'SHORT_TEXT', options: null, order: i })));
    expect(res.status).toBe(200);
  });
});

describe('CSV export of a multi-select', () => {
  it('separates choices with "; " so commas inside a choice stay unambiguous', async () => {
    const [f] = await (async () => {
      const res = await saveI([q({ label: 'Challenges', type: 'CHECKBOX', options: ['Quality, HSE & Compliance', 'FoodTech & Agritech'] })]);
      return (await res.json()).fields as Array<{ id: string }>;
    })();
    await db.update((d) => {
      d.registrations.push({
        id: 'r1', entityType: 'EVENT', entityId: EVENT, incubatorId: INC, mentorId: null, userId: null,
        fullName: 'A B', email: 'a@x.dz', phone: '+213700000000', status: 'CONFIRMED', clientId: null,
        answers: [{ fieldId: f!.id, value: ['Quality, HSE & Compliance', 'FoodTech & Agritech'] }], createdAt: NOW, updatedAt: NOW,
      } as never);
    });
    const csv = await buildRegistrationsCsv('EVENT', EVENT, incubatorScope(INC));
    expect(csv).toContain('"Quality, HSE & Compliance; FoodTech & Agritech"');
    expect(await listFormFields('EVENT', EVENT)).toHaveLength(1);
  });
});

/* ───────────────────────── The Innovation Bridge form itself ───────────────────────── */

describe('Innovation Bridge Algeria form definition', () => {
  const fields = innovationBridgeFields;

  it('fits the builder and passes the same validation the save route applies', async () => {
    expect(fields.length).toBeLessThanOrEqual(MAX_FORM_FIELDS);
    const res = await saveI(fields.map((f, i) => ({ ...f, options: f.options ?? null, order: i })));
    expect(res.status).toBe(200);
    expect(await listFormFields('EVENT', EVENT)).toHaveLength(fields.length);
  });
  it('has the 58 wilayas, once each, as a required dropdown', () => {
    const w = fields.find((f) => f.label === 'Wilaya of residence')!;
    expect(w.type).toBe('DROPDOWN');
    expect(w.required).toBe(true);
    expect(w.options).toHaveLength(58);
    expect(findDuplicateOption(w.options!)).toBeNull();
  });
  it('lists the ten challenge areas as a multi-select', () => {
    const c = fields.find((f) => f.type === 'CHECKBOX' && (f.options?.length ?? 0) === 10)!;
    expect(c.options).toContain('Quality, HSE & Compliance');
    expect(c.required).toBe(true);
  });
  it('makes each declaration its own required single tick, so all three must be given', () => {
    const decl = fields.slice(-3);
    for (const d of decl) {
      expect(d.type).toBe('CHECKBOX');
      expect(d.options).toHaveLength(1);
      expect(d.required).toBe(true);
    }
  });
  it('makes both uploads optional and everything else required', () => {
    for (const f of fields) expect(f.required).toBe(f.type !== 'FILE');
    expect(fields.filter((f) => f.type === 'FILE')).toHaveLength(2);
  });
  it('does not ask again for what the first step already collects', () => {
    for (const f of fields) expect(f.label).not.toMatch(/^(full name|email address|phone number)$/i);
  });
  it('has no free-text year (the builder cannot validate one)', () => {
    expect(fields.find((f) => f.label === 'Year of creation')!.type).toBe('DROPDOWN');
  });
  it('keeps every label and choice within the save limits', () => {
    for (const f of fields) {
      expect(f.label.length).toBeLessThanOrEqual(200);
      for (const o of f.options ?? []) expect(o.length).toBeLessThanOrEqual(200);
    }
  });
});
