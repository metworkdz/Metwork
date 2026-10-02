/**
 * Training feedback — the form, the signed links, the answers and the results.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import { incubatorScope, mentorScope, deleteRegistration } from '@/server/registrations/service';
import {
  ensureFeedbackInvitesSync,
  getFeedbackForm,
  getFeedbackOverview,
  getFeedbackResults,
  listFeedbackParticipants,
  resolveFeedbackLink,
  rotateSharedFeedbackLink,
  saveFeedbackForm,
  submitFeedback,
  type SaveFeedbackFormInput,
} from '@/server/feedback/service';
import { pruneFeedbackForProgramSync } from '@/server/feedback/prune';
import { parseFeedbackToken, personalFeedbackToken, sharedFeedbackToken } from '@/server/feedback/tokens';
import { checkFeedbackAnswers, computeFeedbackResults, type FeedbackQuestion } from '@/server/feedback/types';

const INC = 'inc-fb';
const PROG = 'prog-fb';
const NOW = '2026-09-01T00:00:00.000Z';
const owner = incubatorScope(INC);

function reg(id: string, status = 'CONFIRMED') {
  return {
    id, entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null, userId: null,
    fullName: `Name ${id}`, email: `${id}@x.dz`, phone: '0', answers: [], status, clientId: null,
    bookingId: null, createdAt: NOW, updatedAt: NOW,
  } as never;
}

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [{ id: INC, name: 'Hub Alger', status: 'ACTIVE', managerId: 'mgr', email: 'i@x.dz' } as never];
    d.mentors = [];
    d.programs = [
      { id: PROG, incubatorId: INC, mentorId: null, title: 'Community Manager', slug: 'cm', createdAt: NOW, updatedAt: NOW } as never,
      { id: 'other-prog', incubatorId: 'someone-else', mentorId: null, title: 'Theirs', slug: 'x', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.registrations = [reg('r1'), reg('r2'), reg('r3', 'CANCELLED'), reg('r4', 'WAITLISTED')];
    d.feedbackForms = []; d.feedbackInvites = []; d.feedbackResponses = [];
    d.certificates = [];
  });
});

async function saveDefaults(patch: Partial<SaveFeedbackFormInput> = {}) {
  const view = (await getFeedbackForm(PROG, owner))!;
  const res = await saveFeedbackForm(PROG, owner, {
    title: view.form.title, intro: null, isOpen: true, sharedLinkEnabled: false,
    questions: view.form.questions, ...patch,
  });
  if (!res.ok) throw new Error(res.reason);
  return res.form;
}

async function invite(registrationId: string) {
  const form = (await db.read()).feedbackForms!.find((f) => f.programId === PROG)!;
  const [inv] = await db.update((d) => ensureFeedbackInvitesSync(d, form, [registrationId]));
  return inv!;
}

const ratingsAll = (questions: FeedbackQuestion[], n: number) =>
  questions.filter((q) => q.kind === 'RATING').map((q) => ({ questionId: q.id, rating: n }));

describe('the results', () => {
  const qs: FeedbackQuestion[] = [
    { id: 'a', kind: 'RATING', label: 'A', required: true },
    { id: 'b', kind: 'RATING', label: 'B', required: false },
    { id: 't', kind: 'TEXT', label: 'T', required: false },
  ];

  it('averages every star answer; a 0 counts, a skipped question does not', () => {
    const r = computeFeedbackResults(qs, [
      { answers: [{ questionId: 'a', rating: 5 }, { questionId: 'b', rating: 0 }] },
      { answers: [{ questionId: 'a', rating: 4 }, { questionId: 't', text: 'bien' }] },
    ]);
    expect(r.overall).toBe(3); // (5 + 0 + 4) / 3
    expect(r.questions[0]).toMatchObject({ average: 4.5, count: 2, distribution: [0, 0, 0, 0, 1, 1] });
    expect(r.questions[1]).toMatchObject({ average: 0, count: 1 });
    expect(r.questions[2]).toMatchObject({ average: null, count: 1 });
  });

  it('ignores a deleted question and an out-of-range rating', () => {
    const r = computeFeedbackResults(qs.slice(0, 1), [
      { answers: [{ questionId: 'a', rating: 3 }, { questionId: 'gone', rating: 0 }] },
      { answers: [{ questionId: 'a', rating: 9 }] },
    ]);
    expect(r.overall).toBe(3);
  });

  it('has no rating before anyone answers', () => {
    expect(computeFeedbackResults(qs, []).overall).toBeNull();
  });

  it('checks answers: required, 0–5 integers, text length; drops unknown questions', () => {
    expect(checkFeedbackAnswers(qs, [])).toMatchObject({ ok: false, reason: 'MISSING_REQUIRED', questionId: 'a' });
    expect(checkFeedbackAnswers(qs, [{ questionId: 'a', rating: 6 }])).toMatchObject({ ok: false, reason: 'INVALID_ANSWER' });
    expect(checkFeedbackAnswers(qs, [{ questionId: 'a', rating: 2.5 }])).toMatchObject({ ok: false, reason: 'INVALID_ANSWER' });
    expect(checkFeedbackAnswers(qs, [{ questionId: 'a', rating: 0 }, { questionId: 't', text: 'x'.repeat(2001) }]))
      .toMatchObject({ ok: false, reason: 'INVALID_ANSWER' });
    expect(checkFeedbackAnswers(qs, [{ questionId: 'a', rating: 0 }, { questionId: 'zzz', rating: 5 }, { questionId: 't', text: '  ' }]))
      .toEqual({ ok: true, answers: [{ questionId: 'a', rating: 0 }] });
  });
});

describe('the links', () => {
  it('a signed link round-trips; a forged, altered or foreign one does not', () => {
    const t = personalFeedbackToken('inv-1');
    expect(parseFeedbackToken(t)).toEqual({ kind: 'PERSONAL', inviteId: 'inv-1' });
    expect(parseFeedbackToken(t.replace('inv-1', 'inv-2'))).toBeNull();
    expect(parseFeedbackToken(`${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(parseFeedbackToken('p.inv-1.short')).toBeNull();
    expect(parseFeedbackToken('x'.repeat(500))).toBeNull();
    expect(parseFeedbackToken(sharedFeedbackToken('form-1', 2))).toEqual({ kind: 'SHARED', formId: 'form-1', version: 2 });
    // A shared signature does not open version 3.
    expect(parseFeedbackToken(sharedFeedbackToken('form-1', 2).replace('.2.', '.3.'))).toBeNull();
  });
});

describe('the form', () => {
  it('proposes the default questions until saved, then keeps question ids', async () => {
    const view = (await getFeedbackForm(PROG, owner))!;
    expect(view.saved).toBe(false);
    expect(view.form.questions.map((q) => q.kind)).toEqual(['RATING', 'RATING', 'RATING', 'RATING', 'RATING', 'RATING', 'TEXT', 'TEXT']);
    expect(view.form.questions[4]!.label).toBe('La pause café / déjeuner');

    const form = await saveDefaults();
    const again = (await getFeedbackForm(PROG, owner))!;
    expect(again.saved).toBe(true);
    expect(again.form.questions.map((q) => q.id)).toEqual(form.questions.map((q) => q.id));
  });

  it('starts in the host’s language', async () => {
    const view = (await getFeedbackForm(PROG, owner, 'ar'))!;
    expect(view.form.title).toBe('استبيان الرضا');
  });

  it('refuses another owner’s program, an empty title, duplicate ids, too many questions', async () => {
    expect(await getFeedbackForm('other-prog', owner)).toBeNull();
    expect(await getFeedbackForm(PROG, mentorScope('m1'))).toBeNull();
    const q = { id: 'q1', kind: 'RATING' as const, label: 'A', required: true };
    const base = { title: 'T', isOpen: true, sharedLinkEnabled: false };
    expect(await saveFeedbackForm('other-prog', owner, { ...base, questions: [q] })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await saveFeedbackForm(PROG, owner, { ...base, title: ' ', questions: [q] })).toEqual({ ok: false, reason: 'INVALID' });
    expect(await saveFeedbackForm(PROG, owner, { ...base, questions: [q, q] })).toEqual({ ok: false, reason: 'INVALID' });
    expect(await saveFeedbackForm(PROG, owner, { ...base, questions: Array.from({ length: 21 }, () => ({ ...q, id: null })) }))
      .toEqual({ ok: false, reason: 'INVALID' });
    expect((await db.read()).feedbackForms).toHaveLength(0);
  });
});

describe('answering', () => {
  it('only confirmed participants get an invite', async () => {
    await saveDefaults();
    const form = (await db.read()).feedbackForms![0]!;
    const invites = await db.update((d) => ensureFeedbackInvitesSync(d, form, ['r1', 'r3', 'r4', 'ghost']));
    expect(invites.map((i) => i.registrationId)).toEqual(['r1']);
    // Asking again reuses the invite: same link.
    const again = await db.update((d) => ensureFeedbackInvitesSync(d, form, ['r1']));
    expect(again[0]!.id).toBe(invites[0]!.id);
  });

  it('a personal link: one response per person, edited in place, named for the host', async () => {
    const form = await saveDefaults();
    const inv = await invite('r1');
    const token = personalFeedbackToken(inv.id);

    const link = await resolveFeedbackLink(token);
    expect(link).toMatchObject({ ok: true, organizer: 'Hub Alger', previous: null });

    expect(await submitFeedback(token, ratingsAll(form.questions, 4))).toEqual({ ok: true, updated: false });
    expect(await submitFeedback(token, ratingsAll(form.questions, 2))).toEqual({ ok: true, updated: true });

    const results = (await getFeedbackResults(PROG, owner))!;
    expect(results.responses).toHaveLength(1);
    expect(results.responses[0]).toMatchObject({ fullName: 'Name r1', viaSharedLink: false, average: 2 });
    expect(results.results.overall).toBe(2);
    expect((await resolveFeedbackLink(token)) ).toMatchObject({ ok: true, previous: expect.any(Array) });

    const people = (await listFeedbackParticipants(PROG, owner))!;
    expect(people.map((p) => [p.registrationId, p.responded])).toEqual([['r1', true], ['r2', false]]);
  });

  it('refuses a missing required rating, and writes nothing', async () => {
    await saveDefaults();
    const inv = await invite('r1');
    expect(await submitFeedback(personalFeedbackToken(inv.id), [])).toMatchObject({ ok: false, reason: 'MISSING_REQUIRED' });
    expect((await db.read()).feedbackResponses).toHaveLength(0);
  });

  it('a closed form refuses answers', async () => {
    const form = await saveDefaults({ isOpen: false });
    const inv = await invite('r1');
    const token = personalFeedbackToken(inv.id);
    expect(await resolveFeedbackLink(token)).toEqual({ ok: false, reason: 'CLOSED' });
    expect(await submitFeedback(token, ratingsAll(form.questions, 5))).toEqual({ ok: false, reason: 'CLOSED' });
  });

  it('a cancelled participant’s link stops working', async () => {
    const form = await saveDefaults();
    const inv = await invite('r1');
    await db.update((d) => { d.registrations.find((r) => r.id === 'r1')!.status = 'CANCELLED'; });
    expect(await submitFeedback(personalFeedbackToken(inv.id), ratingsAll(form.questions, 5)))
      .toEqual({ ok: false, reason: 'INVALID' });
  });

  it('the shared link: off by default, unnamed answers, retired by rotating', async () => {
    const form = await saveDefaults();
    const token = sharedFeedbackToken(form.id, form.sharedLinkVersion);
    expect(await resolveFeedbackLink(token)).toEqual({ ok: false, reason: 'INVALID' });

    await saveDefaults({ sharedLinkEnabled: true });
    expect(await submitFeedback(token, ratingsAll(form.questions, 5))).toEqual({ ok: true, updated: false });
    expect(await submitFeedback(token, ratingsAll(form.questions, 3))).toEqual({ ok: true, updated: false });
    const results = (await getFeedbackResults(PROG, owner))!;
    expect(results.responses.map((r) => [r.fullName, r.viaSharedLink])).toEqual([[null, true], [null, true]]);
    expect(results.results.overall).toBe(4);

    await rotateSharedFeedbackLink(PROG, owner);
    expect(await resolveFeedbackLink(token)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('the overview lists every program of the owner, and only theirs', async () => {
    const form = await saveDefaults();
    const inv = await invite('r1');
    await submitFeedback(personalFeedbackToken(inv.id), ratingsAll(form.questions, 5));
    const rows = await getFeedbackOverview(owner);
    expect(rows).toEqual([{ programId: PROG, title: 'Community Manager', overall: 5, responses: 1, sent: 0, status: 'OPEN' }]);
  });
});

describe('deleting', () => {
  it('a deleted registration takes its invite and answers', async () => {
    const form = await saveDefaults();
    const inv = await invite('r1');
    await submitFeedback(personalFeedbackToken(inv.id), ratingsAll(form.questions, 5));
    await db.update((d) => { d.registrations.find((r) => r.id === 'r1')!.status = 'CANCELLED'; });
    expect(await deleteRegistration('r1', owner)).toMatchObject({ ok: true });
    const d = await db.read();
    expect(d.feedbackInvites).toHaveLength(0);
    expect(d.feedbackResponses).toHaveLength(0);
  });

  it('a deleted program takes its form, invites and answers', async () => {
    const form = await saveDefaults();
    const inv = await invite('r1');
    await submitFeedback(personalFeedbackToken(inv.id), ratingsAll(form.questions, 5));
    await db.update((d) => pruneFeedbackForProgramSync(d, PROG));
    const d = await db.read();
    expect([d.feedbackForms, d.feedbackInvites, d.feedbackResponses].map((x) => x!.length)).toEqual([0, 0, 0]);
  });
});
