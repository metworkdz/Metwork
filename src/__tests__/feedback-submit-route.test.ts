/**
 * POST /api/feedback — the participant's answers through a signed link.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { limiter } = vi.hoisted(() => ({ limiter: vi.fn(async () => true) }));
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkRateLimitDistributed: limiter,
}));

import { db } from '@/server/db/store';
import { incubatorScope } from '@/server/registrations/service';
import { ensureFeedbackInvitesSync, getFeedbackForm, saveFeedbackForm } from '@/server/feedback/service';
import { personalFeedbackToken } from '@/server/feedback/tokens';
import { POST } from '@/app/api/feedback/route';

const NOW = '2026-09-01T00:00:00.000Z';
const owner = incubatorScope('inc');
let token = '';
let ratingIds: string[] = [];

beforeEach(async () => {
  limiter.mockClear();
  limiter.mockImplementation(async () => true);
  await db.update((d) => {
    d.incubators = [{ id: 'inc', name: 'Hub', status: 'ACTIVE', managerId: 'm', email: 'i@x.dz' } as never];
    d.programs = [{ id: 'p', incubatorId: 'inc', mentorId: null, title: 'T', slug: 't', createdAt: NOW, updatedAt: NOW } as never];
    d.registrations = [{
      id: 'r1', entityType: 'PROGRAM', entityId: 'p', incubatorId: 'inc', mentorId: null, userId: null,
      fullName: 'Amina B', email: 'a@x.dz', phone: '0', answers: [], status: 'CONFIRMED', clientId: null,
      bookingId: null, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.feedbackForms = []; d.feedbackInvites = []; d.feedbackResponses = [];
  });
  const view = (await getFeedbackForm('p', owner))!;
  const saved = await saveFeedbackForm('p', owner, {
    title: 'T', isOpen: true, sharedLinkEnabled: false, questions: view.form.questions,
  });
  if (!saved.ok) throw new Error('save');
  ratingIds = saved.form.questions.filter((q) => q.kind === 'RATING').map((q) => q.id);
  const [inv] = await db.update((d) => ensureFeedbackInvitesSync(d, saved.form, ['r1']));
  token = personalFeedbackToken(inv!.id);
});

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/feedback', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(body),
}));

describe('POST /api/feedback', () => {
  it('records the answers', async () => {
    const res = await post({ token, answers: ratingIds.map((questionId) => ({ questionId, rating: 4 })) });
    expect(res.status).toBe(200);
    expect((await db.read()).feedbackResponses).toHaveLength(1);
  });

  it('names the missing question', async () => {
    const res = await post({ token, answers: [] });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'MISSING_REQUIRED', details: { questionId: ratingIds[0] } });
  });

  it('refuses a forged link, an out-of-range rating and a closed form', async () => {
    expect((await post({ token: `${token}x`, answers: [] })).status).toBe(404);
    expect((await post({ token, answers: [{ questionId: ratingIds[0], rating: 6 }] })).status).toBe(422);
    await db.update((d) => { d.feedbackForms![0]!.isOpen = false; });
    expect((await post({ token, answers: ratingIds.map((questionId) => ({ questionId, rating: 4 })) })).status).toBe(409);
    expect((await db.read()).feedbackResponses).toHaveLength(0);
  });

  it('is rate-limited per address and per link', async () => {
    limiter.mockImplementation(async () => false);
    expect((await post({ token, answers: [] })).status).toBe(429);
    const keys = limiter.mock.calls.map((c) => (c as unknown[])[0]);
    expect(keys).toEqual(expect.arrayContaining(['feedback-submit:ip:1.2.3.4', `feedback-submit:link:${token}`]));
  });

  it('rejects a malformed body', async () => {
    expect((await post({ token, answers: 'x' })).status).toBe(422);
    expect((await post({})).status).toBe(422);
  });
});
