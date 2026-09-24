/**
 * The answer summary on the registrations tab, and who may see a listing's
 * questions at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

let actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: actor }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'mentor-1' })),
}));

import { db, type RegistrationFormFieldRecord, type RegistrationRecord } from '@/server/db/store';
import { buildAnswerSummary } from '@/server/registrations/answer-summary';

const NOW = '2026-09-01T00:00:00.000Z';

function field(id: string, extra: Partial<RegistrationFormFieldRecord>): RegistrationFormFieldRecord {
  return {
    id, entityType: 'PROGRAM', entityId: 'p-a', incubatorId: 'inc-a', mentorId: null,
    label: id, type: 'MULTIPLE_CHOICE', options: null, required: false, order: 0,
    createdAt: NOW, updatedAt: NOW, ...extra,
  } as RegistrationFormFieldRecord;
}

function reg(id: string, answers: Array<{ fieldId: string; value: string | string[] }>, status = 'CONFIRMED') {
  return {
    id, entityType: 'PROGRAM', entityId: 'p-a', incubatorId: 'inc-a', mentorId: null, userId: null,
    fullName: id, email: `${id}@x.dz`, phone: '0', answers, status, clientId: null,
    createdAt: NOW, updatedAt: NOW,
  } as RegistrationRecord;
}

const format = field('format', { label: 'Format souhaité', options: ['En ligne', 'En présentiel', 'Les deux'], order: 1 });
// A seeded default question: stored in French, answered in each visitor's language.
const stage = field('stage', {
  label: 'Stade / maturité', labelKey: 'stage', type: 'DROPDOWN', order: 0,
  options: ['Idée', 'Prototype / MVP', 'Génère des revenus', 'Croissance / mise à l\'échelle'],
  optionKeys: ['stageIdea', 'stagePrototype', 'stageRevenue', 'stageGrowth'],
});
const topics = field('topics', { label: 'Sujets', type: 'CHECKBOX', options: ['Juridique', 'Fiscalité', 'RH'], order: 2 });
const freeText = field('why', { label: 'Pourquoi ?', type: 'LONG_TEXT', options: null, order: 3 });

describe('counting', () => {
  it('counts confirmed participants per option, sorted by the form\'s order', () => {
    const s = buildAnswerSummary([format, stage, topics, freeText], [
      reg('a', [{ fieldId: 'format', value: 'En ligne' }]),
      reg('b', [{ fieldId: 'format', value: 'En ligne' }]),
      reg('c', [{ fieldId: 'format', value: 'Les deux' }]),
      reg('d', []),
      reg('w', [{ fieldId: 'format', value: 'En présentiel' }], 'WAITLISTED'),
      reg('x', [{ fieldId: 'format', value: 'En présentiel' }], 'CANCELLED'),
    ]);
    expect(s.confirmed).toBe(4);
    expect(s.questions.map((q) => q.fieldId)).toEqual(['stage', 'format', 'topics']);
    expect(s.questions[1]).toMatchObject({ counts: [2, 0, 1], answered: 3, other: 0 });
  });

  it('folds an answer given in Arabic or English into the same option', () => {
    const s = buildAnswerSummary([stage], [
      reg('fr', [{ fieldId: 'stage', value: 'Idée' }]),
      reg('ar', [{ fieldId: 'stage', value: 'فكرة' }]),
      reg('en', [{ fieldId: 'stage', value: 'Idea' }]),
      reg('case', [{ fieldId: 'stage', value: '  idée ' }]),
    ]);
    expect(s.questions[0]).toMatchObject({ counts: [4, 0, 0, 0], other: 0, answered: 4 });
  });

  it('counts each ticked box of a multi-choice question, once per person', () => {
    const s = buildAnswerSummary([topics], [
      reg('a', [{ fieldId: 'topics', value: ['Juridique', 'RH'] }]),
      reg('b', [{ fieldId: 'topics', value: ['Juridique', 'Juridique'] }]),
      reg('c', [{ fieldId: 'topics', value: [] }]),
    ]);
    expect(s.questions[0]).toMatchObject({ counts: [2, 0, 1], answered: 2 });
  });

  it('keeps answers to a renamed option apart instead of losing them', () => {
    const s = buildAnswerSummary([format], [reg('a', [{ fieldId: 'format', value: 'Hybride' }])]);
    expect(s.questions[0]).toMatchObject({ counts: [0, 0, 0], other: 1, answered: 1 });
  });
});

describe('the route', () => {
  beforeEach(async () => {
    actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
    await db.update((d) => {
      d.users = [];
      d.incubators = [
        { id: 'inc-a', name: 'A', managerId: 'mgr-a', email: 'a@x.dz', status: 'ACTIVE' } as never,
        { id: 'inc-b', name: 'B', managerId: 'mgr-b', email: 'b@x.dz', status: 'ACTIVE' } as never,
      ];
      d.programs = [
        { id: 'p-a', incubatorId: 'inc-a', mentorId: null, title: 'A' } as never,
        { id: 'p-b', incubatorId: 'inc-b', mentorId: null, title: 'B' } as never,
      ];
      d.events = [];
      d.registrationFormFields = [format, { ...format, id: 'secret', entityId: 'p-b', incubatorId: 'inc-b', label: 'Question privée de B' }];
      d.registrations = [reg('a', [{ fieldId: 'format', value: 'En ligne' }])];
    });
  });

  const get = (qs: string) => new NextRequest(`http://localhost/api/incubator/registrations?${qs}`);

  it('answers the summary for the owner', async () => {
    const { GET } = await import('@/app/api/incubator/registrations/route');
    const body = await (await GET(get('entityType=PROGRAM&entityId=p-a&view=summary'))).json();
    expect(body.confirmed).toBe(1);
    expect(body.questions[0]).toMatchObject({ fieldId: 'format', counts: [1, 0, 0] });
  });

  it('shows another host\'s questions to nobody — in the summary, the list or the abandoned view', async () => {
    const { GET } = await import('@/app/api/incubator/registrations/route');
    const summary = await (await GET(get('entityType=PROGRAM&entityId=p-b&view=summary'))).json();
    expect(summary).toEqual({ confirmed: 0, questions: [] });
    const list = await (await GET(get('entityType=PROGRAM&entityId=p-b'))).json();
    expect(list.formFields).toEqual([]);
    const abandoned = await (await GET(get('entityType=PROGRAM&entityId=p-b&view=abandoned'))).json();
    expect(abandoned.formFields).toEqual([]);
    expect(JSON.stringify([summary, list, abandoned])).not.toContain('Question privée');
  });

  it('the owner still gets their questions with the list', async () => {
    const { GET } = await import('@/app/api/incubator/registrations/route');
    const list = await (await GET(get('entityType=PROGRAM&entityId=p-a'))).json();
    expect(list.formFields.map((f: { id: string }) => f.id)).toEqual(['format']);
  });
});
