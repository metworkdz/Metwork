/**
 * Startup Academy phase 3 — the Academy Pass: buying, access, renewal, and the
 * per-subscriber monthly split of the FULL Pass price between the mentors
 * watched (owner decisions of 2026-10-31).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, type AcademyCourseRecord } from '@/server/db/store';
import { runPassRenewals, setPassAutoRenew, settlePassMonths, splitSlice, startPassPurchase, passStatusFor } from '@/server/academy/pass';
import { buildSlices } from '@/server/academy/pass-core';
import { startCoursePurchase, settleAcademyOrderFromWebhook } from '@/server/academy/orders';
import { lessonAccess } from '@/server/academy/access';
import { createMemoryAcademyRepo, setAcademyRepoForTests } from '@/server/academy/repo';
import { getConsultationRevenueSummary } from '@/server/mentors/revenue';

const repo = createMemoryAcademyRepo();
const NOW = '2026-10-31T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';
const DAY = 86_400_000;

function user(id: string, extra: Record<string, unknown> = {}) {
  return { id, email: `${id}@x.dz`, fullName: `User ${id}`, phone: '+213555000011', role: 'ENTREPRENEUR', status: 'ACTIVE', approvalStatus: 'APPROVED', membershipCode: null, membershipTier: 'EXPLORER', membershipExpiresAt: null, createdAt: NOW, updatedAt: NOW, ...extra } as never;
}
const lesson = (id: string) => ({ id, title: { source: 'fr', fr: id }, description: null, kind: 'VIDEO', videoId: 'a'.repeat(32), videoStatus: 'READY', durationSec: 600, isPreview: false, resources: [] });
function course(id: string, mentorId: string, extra: Partial<AcademyCourseRecord> = {}): AcademyCourseRecord {
  return {
    id, slug: id, fieldId: 'ideation', mentorIds: [mentorId], title: { source: 'fr', fr: id }, subtitle: null, description: { source: 'fr', fr: 'd' },
    outcomes: [], level: 'BEGINNER', audioLanguage: 'DARIJA_FR', priceDzd: 2900, includedInPass: true, thumbnailUrl: null, trailerVideoId: null,
    status: 'PUBLISHED', createdBy: { kind: 'ADMIN', id: 'a' }, reviewNote: null, submittedAt: null, publishedAt: NOW, createdAt: NOW, updatedAt: NOW,
    modules: [{ id: `${id}-m`, title: { source: 'fr', fr: 'M' }, comingSoon: false, lessons: [lesson(`${id}-l1`)] }],
    ...extra,
  } as AcademyCourseRecord;
}

const buyer = (id: string) => db.read().then((d) => d.users.find((u) => u.id === id)!);
const wallet = (id: string) => db.read().then((d) => d.wallets.find((w) => w.userId === id)?.balance ?? 0);
const mentorWallet = (id: string) => db.read().then((d) => d.mentorWallets?.find((w) => w.mentorId === id));
const subscribe = async (userId: string, plan: 'MONTHLY' | 'ANNUAL' = 'MONTHLY', method: 'WALLET' | 'CARD' = 'WALLET') =>
  startPassPurchase({ user: await buyer(userId), plan, method, clientReference: `p-${userId}-${Math.random()}`, appBaseUrl: 'http://localhost:3000', locale: 'fr' });

beforeEach(async () => {
  repo.reset();
  setAcademyRepoForTests(repo);
  delete process.env.MOCK_PAYMENT_MODE;
  await db.update((d) => {
    d.users = [user('u-free'), user('u-founder', { membershipCode: 'STARTUP', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE }), user('u-poor')];
    d.wallets = ['u-free', 'u-founder', 'u-poor'].map((id, i) => ({ id: `w${i}`, userId: id, balance: id === 'u-poor' ? 100 : 100_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW })) as never;
    d.transactions = [];
    d.mentors = [{ id: 'm-1', fullName: 'Yacine', approvalStatus: 'APPROVED' } as never, { id: 'm-2', fullName: 'Nadia', approvalStatus: 'APPROVED', academyShareRate: 0.4 } as never];
    d.mentorWallets = [];
    d.mentorLedgerTxns = [];
    d.academyCourses = [course('c-1', 'm-1'), course('c-2', 'm-2'), course('c-out', 'm-1', { includedInPass: false })];
    d.academyEnrollments = [];
    d.academyOrders = [];
    d.academyPasses = [];
    d.academySettings = null;
    d.notifications = [];
  });
});
afterEach(() => { delete process.env.MOCK_PAYMENT_MODE; });

describe('buying the Pass', () => {
  it('monthly 3 500 DA, yearly 33 600 DA; Premium −20 % on both', async () => {
    const s = await passStatusFor(await buyer('u-founder'));
    expect([s.quotes.MONTHLY.amountDzd, s.quotes.ANNUAL.amountDzd]).toEqual([2800, 26880]);
    expect(await subscribe('u-free')).toMatchObject({ ok: true, state: 'PAID' });
    expect(await wallet('u-free')).toBe(96_500);
    const p = (await db.read()).academyPasses![0]!;
    expect(p).toMatchObject({ plan: 'MONTHLY', autoRenew: true, listPriceDzd: 3500, amountDzd: 3500 });
    expect(p.slices).toHaveLength(1);
  });

  it('a renewing monthly Pass cannot be bought twice; a cancelled one is extended from its end', async () => {
    await subscribe('u-free');
    expect(await subscribe('u-free')).toEqual({ ok: false, code: 'ALREADY_SUBSCRIBED' });
    expect(await setPassAutoRenew('u-free', false)).toEqual({ ok: true });
    await subscribe('u-free', 'ANNUAL');
    const [first, second] = (await db.read()).academyPasses!;
    expect(second!.periodStart).toBe(first!.periodEnd);
    expect(first!.autoRenew).toBe(false);
    expect(second!.slices).toHaveLength(12);
  });

  it('card: the webhook grants the term once', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await subscribe('u-free', 'MONTHLY', 'CARD');
    const orderId = res.ok ? res.orderId : '';
    expect((await db.read()).academyPasses).toHaveLength(0);
    expect(await settleAcademyOrderFromWebhook(orderId, 'p1', 'COMPLETED')).toBe('SETTLED');
    expect(await settleAcademyOrderFromWebhook(orderId, 'p1', 'COMPLETED')).toBe('ALREADY');
    expect((await db.read()).academyPasses).toHaveLength(1);
    expect(await wallet('u-free')).toBe(100_000);
  });

  it('annual slices add up exactly to the term', () => {
    const s = buildSlices('ANNUAL', '2026-01-15T00:00:00.000Z', '2027-01-15T00:00:00.000Z', 33_601, 26_881);
    expect(s).toHaveLength(12);
    expect(s.reduce((a, x) => a + x.baseDzd, 0)).toBe(33_601);
    expect(s.reduce((a, x) => a + x.paidDzd, 0)).toBe(26_881);
    expect(s[0]!.end).toBe('2026-02-15T00:00:00.000Z');
    expect(s[11]!.end).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('Pass access', () => {
  const free = { id: 'u-free', role: 'ENTREPRENEUR' };
  it('opens published Pass courses only, and an owned course stays OWNED', async () => {
    expect(await lessonAccess(free, 'c-1', 'c-1-l1')).toMatchObject({ ok: false, code: 'LOCKED' });
    await subscribe('u-free');
    expect(await lessonAccess(free, 'c-1', 'c-1-l1')).toMatchObject({ ok: true, access: 'PASS' });
    expect(await lessonAccess(free, 'c-out', 'c-out-l1')).toMatchObject({ ok: false, code: 'LOCKED' });
    await startCoursePurchase({ user: await buyer('u-free'), courseSlug: 'c-2', method: 'WALLET', clientReference: 'buy-c2-xyz', appBaseUrl: 'x', locale: 'fr' });
    expect(await lessonAccess(free, 'c-2', 'c-2-l1')).toMatchObject({ ok: true, access: 'OWNED' });
    await db.update((d) => { d.academyCourses![0]!.status = 'ARCHIVED'; });
    expect(await lessonAccess(free, 'c-1', 'c-1-l1')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('access ends with the term', async () => {
    await subscribe('u-free');
    await db.update((d) => { const p = d.academyPasses![0]!; p.periodEnd = new Date(Date.now() - 1000).toISOString(); });
    expect(await lessonAccess(free, 'c-1', 'c-1-l1')).toMatchObject({ ok: false, code: 'LOCKED' });
  });
});

describe('renewal', () => {
  const shift = async (userId: string, endsInMs: number) => db.update((d) => {
    const p = d.academyPasses!.find((x) => x.userId === userId)!;
    p.periodEnd = new Date(Date.now() + endsInMs).toISOString();
    p.slices[0]!.end = p.periodEnd;
  });

  it('reminds once 3 days before, renews from the wallet at the live price, continues without a gap', async () => {
    await subscribe('u-founder');
    await shift('u-founder', 2 * DAY);
    expect(await runPassRenewals()).toMatchObject({ reminded: 1, renewed: 0 });
    expect(await runPassRenewals()).toMatchObject({ reminded: 0 });
    await db.update((d) => { d.academySettings = { passMonthlyPriceDzd: 4000 } as never; });
    await shift('u-founder', -1000);
    const oldEnd = (await db.read()).academyPasses![0]!.periodEnd;
    expect(await runPassRenewals()).toMatchObject({ renewed: 1, expired: 1 });
    const terms = (await db.read()).academyPasses!;
    expect(terms).toHaveLength(2);
    expect(terms[1]).toMatchObject({ periodStart: oldEnd, listPriceDzd: 4000, amountDzd: 3200, method: 'RENEWAL', autoRenew: true });
    expect(await wallet('u-founder')).toBe(100_000 - 2800 - 3200);
    expect(await runPassRenewals()).toMatchObject({ renewed: 0 });
  });

  it('not enough in the wallet: the Pass ends; cancelled Passes and yearly ones just expire', async () => {
    await db.update((d) => { d.wallets.find((w) => w.userId === 'u-poor')!.balance = 3500; });
    await subscribe('u-poor');
    await shift('u-poor', -1000);
    expect(await runPassRenewals()).toMatchObject({ lapsed: 1, renewed: 0 });
    await subscribe('u-free', 'ANNUAL');
    await shift('u-free', -1000);
    expect(await runPassRenewals()).toMatchObject({ expired: 1, renewed: 0 });
  });
});

describe('monthly settlement to mentors', () => {
  it('pure split: each mentor gets the FULL price × their share × their part of this subscriber’s time', () => {
    const rate = (m: string) => (m === 'm-2' ? 0.4 : 0.3);
    expect(splitSlice(3500, [{ mentorId: 'm-1', seconds: 1800 }, { mentorId: 'm-2', seconds: 1200 }], rate)).toEqual([
      { mentorId: 'm-1', seconds: 1800, rate: 0.3, amountDzd: 630 },
      { mentorId: 'm-2', seconds: 1200, rate: 0.4, amountDzd: 560 },
    ]);
    expect(splitSlice(3500, [], rate)).toEqual([]);
  });

  it('settles an ended month once, on the full price even for a Premium subscriber, withdrawable at once', async () => {
    await subscribe('u-founder');
    const term = (await db.read()).academyPasses![0]!;
    const day = term.periodStart.slice(0, 10);
    await repo.addWatch({ userId: 'u-founder', lessonId: 'c-1-l1', courseId: 'c-1', mentorId: 'm-1', access: 'PASS', day, elapsedSec: 30, lessonDurationSec: 600 });
    await repo.addWatch({ userId: 'u-founder', lessonId: 'c-2-l1', courseId: 'c-2', mentorId: 'm-2', access: 'PASS', day, elapsedSec: 20, lessonDurationSec: 600 });
    // Someone else's Pass time never moves this subscriber's money.
    await repo.addWatch({ userId: 'u-free', lessonId: 'c-2-l1', courseId: 'c-2', mentorId: 'm-2', access: 'PASS', day, elapsedSec: 35, lessonDurationSec: 600 });

    expect(await settlePassMonths()).toEqual({ settled: 0, credited: 0 }); // month not over
    const after = new Date(new Date(term.periodEnd).getTime() + 1000);
    expect(await settlePassMonths(after)).toEqual({ settled: 1, credited: 2 });
    expect(await settlePassMonths(after)).toEqual({ settled: 0, credited: 0 });
    expect(await mentorWallet('m-1')).toMatchObject({ availableBalance: 630, pendingBalance: 0 }); // 3500 × 30 % × 30/50
    expect(await mentorWallet('m-2')).toMatchObject({ availableBalance: 560 }); //                3500 × 40 % × 20/50
    const slice = (await db.read()).academyPasses![0]!.slices[0]!;
    expect(slice.lines.map((l) => l.amountDzd)).toEqual([630, 560]);
    // Academy rows stay out of the consultations revenue summary.
    expect((await getConsultationRevenueSummary()).settledCount).toBe(0);
  });

  it('two settlement runs at the same moment pay a month once', async () => {
    await subscribe('u-free');
    const term = (await db.read()).academyPasses![0]!;
    await repo.addWatch({ userId: 'u-free', lessonId: 'c-1-l1', courseId: 'c-1', mentorId: 'm-1', access: 'PASS', day: term.periodStart.slice(0, 10), elapsedSec: 30, lessonDurationSec: 600 });
    const after = new Date(new Date(term.periodEnd).getTime() + 1000);
    const [a, b] = await Promise.all([settlePassMonths(after), settlePassMonths(after)]);
    expect(a.credited + b.credited).toBe(1);
    expect(await mentorWallet('m-1')).toMatchObject({ availableBalance: 1050 });
  });

  it('nothing watched: the month stays with Metwork', async () => {
    await subscribe('u-free');
    const term = (await db.read()).academyPasses![0]!;
    expect(await settlePassMonths(new Date(new Date(term.periodEnd).getTime() + 1000))).toEqual({ settled: 1, credited: 0 });
    expect(await mentorWallet('m-1')).toBeUndefined();
  });
});
