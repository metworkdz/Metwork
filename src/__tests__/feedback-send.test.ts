/**
 * Sending the feedback form by email — to everyone not sent it yet, or to
 * chosen people; never twice by accident.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async (_o: { to: string; subject: string; html: string; replyTo?: string }) => true) }));
vi.mock('@/server/notifications/email', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendResendEmail: sendMail,
}));
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: { id: 'mgr', email: 'i@x.dz', role: 'INCUBATOR' } }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
vi.mock('@/server/incubator/service', () => ({
  findIncubatorByUserEmail: vi.fn(async () => ({ id: 'inc' })),
}));

import { db } from '@/server/db/store';
import { incubatorScope } from '@/server/registrations/service';
import { getFeedbackForm, saveFeedbackForm } from '@/server/feedback/service';
import { feedbackEmail, sendFeedbackInvites } from '@/server/feedback/send';
import { parseFeedbackToken } from '@/server/feedback/tokens';

const NOW = '2026-09-01T00:00:00.000Z';
const owner = incubatorScope('inc');

function reg(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, entityType: 'PROGRAM', entityId: 'p', incubatorId: 'inc', mentorId: null, userId: null,
    fullName: `Person ${id}`, email: `${id}@x.dz`, phone: '0', answers: [], status: 'CONFIRMED', clientId: null,
    bookingId: null, createdAt: NOW, updatedAt: NOW, ...extra,
  } as never;
}

async function saveForm(isOpen = true) {
  const view = (await getFeedbackForm('p', owner))!;
  await saveFeedbackForm('p', owner, { title: 'T', isOpen, sharedLinkEnabled: false, questions: view.form.questions });
}

beforeEach(async () => {
  sendMail.mockClear();
  sendMail.mockImplementation(async () => true);
  await db.update((d) => {
    d.incubators = [{ id: 'inc', name: 'Hub Alger', status: 'ACTIVE', managerId: 'mgr', email: 'contact@hub.dz' } as never];
    d.mentors = [];
    d.programs = [{ id: 'p', incubatorId: 'inc', mentorId: null, title: 'Community Manager', slug: 'cm', createdAt: NOW, updatedAt: NOW } as never];
    d.registrations = [reg('r1'), reg('r2', { locale: 'ar' }), reg('r3', { status: 'CANCELLED' })];
    d.feedbackForms = []; d.feedbackInvites = []; d.feedbackResponses = [];
  });
});

describe('sending', () => {
  it('needs a saved, open form', async () => {
    expect(await sendFeedbackInvites('p', owner)).toEqual({ ok: false, reason: 'NOT_SAVED' });
    await saveForm(false);
    expect(await sendFeedbackInvites('p', owner)).toEqual({ ok: false, reason: 'CLOSED' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends to every confirmed participant once, with a personal link, replying to the organizer', async () => {
    await saveForm();
    expect(await sendFeedbackInvites('p', owner)).toEqual({ ok: true, sent: 2, failed: [], remaining: 0 });
    expect(sendMail.mock.calls.map((c) => c[0].to).sort()).toEqual(['r1@x.dz', 'r2@x.dz']);
    expect(sendMail.mock.calls[0]![0].replyTo).toBe('contact@hub.dz');

    const d = await db.read();
    expect(d.feedbackInvites!.every((i) => i.sentAt && !i.emailClaimedAt)).toBe(true);

    // The link in the email opens that person's invite.
    const html = sendMail.mock.calls.find((c) => c[0].to === 'r1@x.dz')![0].html;
    const token = /feedback\/([^"]+)"/.exec(html)![1]!;
    const invite = d.feedbackInvites!.find((i) => i.registrationId === 'r1')!;
    expect(parseFeedbackToken(token)).toEqual({ kind: 'PERSONAL', inviteId: invite.id });

    // Asking again sends nobody.
    sendMail.mockClear();
    expect(await sendFeedbackInvites('p', owner)).toEqual({ ok: true, sent: 0, failed: [], remaining: 0 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a resend to a named person goes out again, with the same link', async () => {
    await saveForm();
    await sendFeedbackInvites('p', owner);
    const first = sendMail.mock.calls.find((c) => c[0].to === 'r1@x.dz')![0].html;
    sendMail.mockClear();
    expect(await sendFeedbackInvites('p', owner, { registrationIds: ['r1'] })).toMatchObject({ ok: true, sent: 1 });
    expect(sendMail.mock.calls[0]![0].html).toBe(first);
  });

  it('never sends to a cancelled participant, even when named', async () => {
    await saveForm();
    expect(await sendFeedbackInvites('p', owner, { registrationIds: ['r3'] })).toEqual({ ok: false, reason: 'NONE' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a failed email is reported, released and skippable', async () => {
    await saveForm();
    sendMail.mockImplementation(async (o) => o.to !== 'r1@x.dz');
    const res = await sendFeedbackInvites('p', owner);
    expect(res).toMatchObject({ ok: true, sent: 1, failed: [{ registrationId: 'r1' }] });
    const d = await db.read();
    const inv = d.feedbackInvites!.find((i) => i.registrationId === 'r1')!;
    expect(inv).toMatchObject({ sentAt: null, emailClaimedAt: null });
    sendMail.mockClear();
    expect(await sendFeedbackInvites('p', owner, { skip: ['r1'] })).toMatchObject({ ok: true, sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('another owner’s program is not found', async () => {
    await saveForm();
    expect(await sendFeedbackInvites('p', incubatorScope('other'))).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

describe('the email', () => {
  it('speaks the participant’s language, escapes names, keeps the subject on one line', () => {
    const ar = feedbackEmail({
      registration: { fullName: '<b>أمينة Benali', locale: 'ar' }, programTitle: 'Titre\r\nBcc: x', organizer: 'Hub', inviteId: 'inv-1',
    });
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('&lt;b&gt;');
    expect(ar.url).toContain('/ar/feedback/p.inv-1.');
    expect(ar.subject).not.toMatch(/[\r\n]/);

    const fr = feedbackEmail({ registration: { fullName: 'Amina Benali', locale: null }, programTitle: 'CM', organizer: 'Hub', inviteId: 'inv-2' });
    expect(fr.subject).toBe('Votre avis sur « CM »');
    expect(fr.html).toContain('Bonjour <strong>Amina</strong>');
    expect(fr.html).toContain('privé');
  });
});

describe('the routes', () => {
  it('save, read the shared link, send, and read the results', async () => {
    const base = 'http://localhost/api/incubator/programs/p/feedback';
    const ctx = { params: Promise.resolve({ id: 'p' }) };
    const formRoute = await import('@/app/api/incubator/programs/[id]/feedback/route');
    const view = await (await formRoute.GET(new NextRequest(base), ctx)).json();
    expect(view).toMatchObject({ saved: false, sharedUrl: null });

    const put = await formRoute.PUT(new NextRequest(base, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', isOpen: true, sharedLinkEnabled: true, questions: view.form.questions }),
    }), ctx);
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(saved.saved).toBe(true);
    expect(parseFeedbackToken(saved.sharedUrl.split('/feedback/')[1])).toMatchObject({ kind: 'SHARED' });

    const rotate = await import('@/app/api/incubator/programs/[id]/feedback/rotate-link/route');
    const rotated = await (await rotate.POST(new NextRequest(`${base}/rotate-link`, { method: 'POST' }), ctx)).json();
    expect(rotated.sharedUrl).not.toBe(saved.sharedUrl);

    const send = await import('@/app/api/incubator/programs/[id]/feedback/send/route');
    const sent = await send.POST(new NextRequest(`${base}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }), ctx);
    expect(await sent.json()).toEqual({ sent: 2, failed: [], remaining: 0 });

    const people = await import('@/app/api/incubator/programs/[id]/feedback/participants/route');
    const list = await (await people.GET(new NextRequest(`${base}/participants`), ctx)).json();
    expect(list.items.map((p: { sentAt: string | null }) => Boolean(p.sentAt))).toEqual([true, true]);

    const results = await import('@/app/api/incubator/programs/[id]/feedback/results/route');
    expect(await (await results.GET(new NextRequest(`${base}/results`), ctx)).json())
      .toMatchObject({ sent: 2, responses: [], results: { overall: null } });
  });

  it('an empty question is refused', async () => {
    const formRoute = await import('@/app/api/incubator/programs/[id]/feedback/route');
    const res = await formRoute.PUT(new NextRequest('http://localhost/x', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', isOpen: true, sharedLinkEnabled: false, questions: [{ kind: 'RATING', label: '  ', required: true }] }),
    }), { params: Promise.resolve({ id: 'p' }) });
    expect(res.status).toBe(422);
  });
});
