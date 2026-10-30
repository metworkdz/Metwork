/**
 * Startup Academy phase 2 — buying (wallet and card), the mentors' earnings
 * (30 % of the FULL price, held for the refund window), refunds to the wallet,
 * the release cron, the webhook path and who may watch which lesson.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, type AcademyCourseRecord } from '@/server/db/store';
import {
  refundCheck,
  refundEnrollment,
  releaseAcademyEarnings,
  settleAcademyOrderFromWebhook,
  startCoursePurchase,
} from '@/server/academy/orders';
import { lessonAccess } from '@/server/academy/access';
import { createMemoryAcademyRepo, setAcademyRepoForTests } from '@/server/academy/repo';
import { dispatchWebhookSettlement } from '@/server/payments/settle-dispatch';

const repo = createMemoryAcademyRepo();
const FUTURE = '2030-01-01T00:00:00.000Z';
const NOW = '2026-10-26T10:00:00.000Z';

function user(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: `User ${id}`, phone: '+213555000011', role: 'ENTREPRENEUR', status: 'ACTIVE',
    approvalStatus: 'APPROVED', membershipCode: null, membershipTier: 'EXPLORER', membershipExpiresAt: null,
    createdAt: NOW, updatedAt: NOW, ...extra,
  } as never;
}
const FOUNDER = { membershipCode: 'STARTUP', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE };

function lesson(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: { source: 'fr', fr: id }, description: null, kind: 'VIDEO', videoId: 'a'.repeat(32), videoStatus: 'READY', durationSec: 100, isPreview: false, resources: [], ...extra };
}

function course(extra: Partial<AcademyCourseRecord> = {}): AcademyCourseRecord {
  return {
    id: 'c-1', slug: 'idee', fieldId: 'ideation', mentorIds: ['m-1'], title: { source: 'fr', fr: 'Idée' }, subtitle: null,
    description: { source: 'fr', fr: 'd' }, outcomes: [], level: 'BEGINNER', audioLanguage: 'DARIJA_FR', priceDzd: 2900, includedInPass: true,
    thumbnailUrl: null, trailerVideoId: null, status: 'PUBLISHED', createdBy: { kind: 'ADMIN', id: 'a' }, reviewNote: null,
    submittedAt: null, publishedAt: NOW, createdAt: NOW, updatedAt: NOW,
    modules: [
      { id: 'mod-1', title: { source: 'fr', fr: 'M1' }, comingSoon: false, lessons: [lesson('l-1', { isPreview: true }), lesson('l-2'), lesson('l-3'), lesson('l-4')] },
      { id: 'mod-2', title: { source: 'fr', fr: 'M2' }, comingSoon: true, lessons: [lesson('l-5')] },
    ],
    ...extra,
  } as AcademyCourseRecord;
}

const buyer = (id: string) => db.read().then((d) => d.users.find((u) => u.id === id)!);
const wallet = (id: string) => db.read().then((d) => d.wallets.find((w) => w.userId === id)?.balance ?? 0);
const mentorWallet = (id: string) => db.read().then((d) => d.mentorWallets?.find((w) => w.mentorId === id));

async function buy(userId: string, method: 'WALLET' | 'CARD' = 'WALLET', ref = `ref-${userId}-${Math.random()}`) {
  return startCoursePurchase({ user: await buyer(userId), courseSlug: 'idee', method, clientReference: ref, appBaseUrl: 'http://localhost:3000', locale: 'fr' });
}

beforeEach(async () => {
  repo.reset();
  setAcademyRepoForTests(repo);
  delete process.env.MOCK_PAYMENT_MODE;
  await db.update((d) => {
    d.users = [user('u-free'), user('u-founder', FOUNDER), user('u-poor'), user('u-free2', { role: 'INVESTOR' })];
    d.wallets = [
      { id: 'w1', userId: 'u-free', balance: 10_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
      { id: 'w2', userId: 'u-founder', balance: 10_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
      { id: 'w3', userId: 'u-poor', balance: 100, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ];
    d.transactions = [];
    d.mentors = [{ id: 'm-1', fullName: 'Yacine', approvalStatus: 'APPROVED' } as never, { id: 'm-2', fullName: 'Nadia', approvalStatus: 'APPROVED', academyShareRate: 0.4 } as never];
    d.mentorWallets = [];
    d.mentorLedgerTxns = [];
    d.academyCourses = [course()];
    d.academyEnrollments = [];
    d.academyOrders = [];
    d.academySettings = null;
    d.notifications = [];
  });
});
afterEach(() => { delete process.env.MOCK_PAYMENT_MODE; });

describe('buying with the wallet', () => {
  it('debits, enrolls and holds the mentor 30 % of the price — in one write', async () => {
    const res = await buy('u-free');
    expect(res).toMatchObject({ ok: true, state: 'PAID', courseSlug: 'idee' });
    expect(await wallet('u-free')).toBe(7100);
    const d = await db.read();
    expect(d.academyEnrollments).toHaveLength(1);
    expect(d.academyEnrollments![0]).toMatchObject({ userId: 'u-free', pricePaidDzd: 2900, discount: 'NONE', mentorShareRate: 0.3 });
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 870, availableBalance: 0 });
  });

  it('Premium pays −20 %; the mentor still earns on the full price (Metwork absorbs it)', async () => {
    await buy('u-founder');
    expect(await wallet('u-founder')).toBe(10_000 - 2320);
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 870 });
    const commission = (await db.read()).mentorLedgerTxns!.find((t) => t.type === 'COMMISSION');
    expect(commission?.metadata).toMatchObject({ gross: 2320, consultantShare: 870, platformShare: 1450, tierDiscountAmount: 580 });
  });

  it('the same click twice charges once; buying an owned course is refused', async () => {
    const a = await buy('u-free', 'WALLET', 'same-ref-123');
    const b = await buy('u-free', 'WALLET', 'same-ref-123');
    expect(b).toEqual(a);
    expect(await wallet('u-free')).toBe(7100);
    expect(await buy('u-free')).toEqual({ ok: false, code: 'ALREADY_OWNED' });
  });

  it('not enough money or not a buyer: nothing changes', async () => {
    expect(await buy('u-poor')).toEqual({ ok: false, code: 'INSUFFICIENT_FUNDS', balance: 100, required: 2900 });
    expect(await buy('u-free2')).toEqual({ ok: false, code: 'NOT_A_BUYER' });
    const d = await db.read();
    expect(d.academyEnrollments).toHaveLength(0);
    expect(d.academyOrders).toHaveLength(0);
    expect(d.mentorLedgerTxns).toHaveLength(0);
  });

  it('co-mentors split the share evenly, each at their own rate', async () => {
    await db.update((d) => { d.academyCourses = [course({ mentorIds: ['m-1', 'm-2'] })]; });
    await buy('u-free');
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 435 }); // 1450 × 30 %
    expect(await mentorWallet('m-2')).toMatchObject({ pendingBalance: 580 }); // 1450 × 40 %
  });
});

describe('who counts as Premium', () => {
  it('Founder under any of its stored spellings; Freelancer Premium; not the retired Entrepreneur plan', async () => {
    const { isAcademyPremium } = await import('@/lib/academy');
    expect(isAcademyPremium({ role: 'ENTREPRENEUR', membershipCode: 'FOUNDER' })).toBe(true);
    expect(isAcademyPremium({ role: 'ENTREPRENEUR', membershipCode: 'startup' })).toBe(true);
    expect(isAcademyPremium({ role: 'ENTREPRENEUR', membershipCode: null, membershipTier: 'FOUNDER' })).toBe(true);
    expect(isAcademyPremium({ role: 'ENTREPRENEUR', membershipCode: 'ENTREPRENEUR', membershipTier: 'BUILDER' })).toBe(false);
    expect(isAcademyPremium({ role: 'FREELANCER', membershipCode: 'FREELANCER_PREMIUM', membershipTier: 'FOUNDER' })).toBe(true);
    expect(isAcademyPremium({ role: 'FREELANCER', membershipCode: null, membershipTier: 'FOUNDER' })).toBe(false);
    expect(isAcademyPremium({ role: 'ENTREPRENEUR', membershipCode: 'STARTUP', membershipExpiresAt: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(isAcademyPremium({ role: 'INVESTOR', membershipCode: 'STARTUP' })).toBe(false);
  });
});

describe('buying by card', () => {
  it('async: order waits; the verified webhook settles once, replays move nothing', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await buy('u-free', 'CARD');
    expect(res).toMatchObject({ ok: true, state: 'REDIRECT' });
    const orderId = res.ok ? res.orderId : '';
    expect((await db.read()).academyEnrollments).toHaveLength(0);

    const r1 = await dispatchWebhookSettlement({ topUpId: orderId, providerRef: 'p1', status: 'COMPLETED' });
    expect(r1).toMatchObject({ matched: true, kind: 'academy_order' });
    expect(await settleAcademyOrderFromWebhook(orderId, 'p1', 'COMPLETED')).toBe('ALREADY');
    const d = await db.read();
    expect(d.academyEnrollments).toHaveLength(1);
    expect(await wallet('u-free')).toBe(10_000); // the card paid, not the wallet
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 870 });
  });

  it('a failed card payment marks the order failed and grants nothing', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await buy('u-free', 'CARD');
    const orderId = res.ok ? res.orderId : '';
    expect(await settleAcademyOrderFromWebhook(orderId, 'p1', 'FAILED')).toBe('IGNORED');
    expect((await db.read()).academyOrders![0]!.status).toBe('FAILED');
    expect((await db.read()).academyEnrollments).toHaveLength(0);
  });

  it('two payments for the same course: the second goes back to the wallet', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const a = await buy('u-free', 'CARD');
    const b = await buy('u-free', 'CARD');
    await settleAcademyOrderFromWebhook(a.ok ? a.orderId : '', 'p1', 'COMPLETED');
    await settleAcademyOrderFromWebhook(b.ok ? b.orderId : '', 'p2', 'COMPLETED');
    const d = await db.read();
    expect(d.academyEnrollments).toHaveLength(1);
    expect(d.academyOrders!.find((o) => o.id === (b.ok ? b.orderId : ''))?.duplicateRefunded).toBe(true);
    expect(await wallet('u-free')).toBe(12_900);
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 870 });
  });

  it('sync provider (mock) settles at once', async () => {
    expect(await buy('u-free', 'CARD')).toMatchObject({ ok: true, state: 'PAID' });
    expect((await db.read()).academyEnrollments).toHaveLength(1);
  });
});

describe('refunds and release', () => {
  it('refund within 7 days under 25 % watched: money to the wallet, earning voided', async () => {
    await buy('u-founder');
    const e = (await db.read()).academyEnrollments![0]!;
    expect(await refundCheck('u-founder', e.id)).toMatchObject({ eligible: true, amountDzd: 2320 });
    expect(await refundEnrollment('u-founder', e.id)).toEqual({ ok: true, amountDzd: 2320 });
    expect(await wallet('u-founder')).toBe(10_000);
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 0, availableBalance: 0 });
    expect(await refundEnrollment('u-founder', e.id)).toEqual({ ok: false, reason: 'ALREADY_REFUNDED' });
    // A refunded sale no longer counts as Metwork revenue.
    expect((await db.read()).mentorLedgerTxns!.find((t) => t.type === 'COMMISSION')?.status).toBe('REVERSED');
    expect(await lessonAccess({ id: 'u-founder', role: 'ENTREPRENEUR' }, 'c-1', 'l-2')).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('two refund clicks at the same moment pay back once', async () => {
    await buy('u-free');
    const e = (await db.read()).academyEnrollments![0]!;
    const results = await Promise.all([refundEnrollment('u-free', e.id), refundEnrollment('u-free', e.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await wallet('u-free')).toBe(10_000);
  });

  it('no refund once 25 % was watched (100 of 400 s released)', async () => {
    await buy('u-free');
    const e = (await db.read()).academyEnrollments![0]!;
    for (let i = 0; i < 3; i++) await repo.addWatch({ userId: 'u-free', lessonId: 'l-2', courseId: 'c-1', mentorId: 'm-1', access: 'OWNED', day: '2026-10-26', elapsedSec: 35, lessonDurationSec: 100 });
    expect(await refundCheck('u-free', e.id)).toEqual({ eligible: false, reason: 'WATCHED_TOO_MUCH' });
  });

  it('after 7 days the cron releases the earning, and the refund is closed', async () => {
    await buy('u-free');
    const e = (await db.read()).academyEnrollments![0]!;
    expect(await releaseAcademyEarnings(new Date(Date.now() + 6 * 86_400_000))).toEqual({ released: 0 });
    expect(await releaseAcademyEarnings(new Date(Date.now() + 8 * 86_400_000))).toEqual({ released: 1 });
    expect(await releaseAcademyEarnings(new Date(Date.now() + 9 * 86_400_000))).toEqual({ released: 0 });
    expect(await mentorWallet('m-1')).toMatchObject({ pendingBalance: 0, availableBalance: 870 });
    expect(await refundCheck('u-free', e.id)).toEqual({ eligible: false, reason: 'WINDOW_CLOSED' });
  });
});

describe('who may watch', () => {
  const free = { id: 'u-free', role: 'ENTREPRENEUR' };
  it('previews for any account, the rest for owners and admins', async () => {
    expect(await lessonAccess(free, 'c-1', 'l-1')).toMatchObject({ ok: true, access: 'PREVIEW' });
    expect(await lessonAccess(free, 'c-1', 'l-2')).toMatchObject({ ok: false, code: 'LOCKED' });
    await buy('u-free');
    expect(await lessonAccess(free, 'c-1', 'l-2')).toMatchObject({ ok: true, access: 'OWNED' });
    expect(await lessonAccess({ id: 'x', role: 'ADMIN' }, 'c-1', 'l-3')).toMatchObject({ ok: true, access: 'ADMIN' });
  });

  it('coming-soon lessons and videos not ready never play', async () => {
    await buy('u-free');
    expect(await lessonAccess(free, 'c-1', 'l-5')).toMatchObject({ ok: false, code: 'NOT_READY' });
    await db.update((d) => { d.academyCourses![0]!.modules[0]!.lessons[3]!.videoStatus = 'PROCESSING'; });
    expect(await lessonAccess(free, 'c-1', 'l-4')).toMatchObject({ ok: false, code: 'NOT_READY' });
  });

  it('an archived course stays open to its buyers only; drafts only to admins', async () => {
    await buy('u-free');
    await db.update((d) => { d.academyCourses![0]!.status = 'ARCHIVED'; });
    expect(await lessonAccess(free, 'c-1', 'l-2')).toMatchObject({ ok: true });
    expect(await lessonAccess({ id: 'u-founder', role: 'ENTREPRENEUR' }, 'c-1', 'l-1')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await db.update((d) => { d.academyCourses![0]!.status = 'DRAFT'; });
    expect(await lessonAccess(free, 'c-1', 'l-2')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await lessonAccess({ id: 'x', role: 'ADMIN' }, 'c-1', 'l-2')).toMatchObject({ ok: true });
  });
});

describe('one stream per account', () => {
  it('a second device takes over; the first gets TAKEN', async () => {
    const s1 = await repo.startStream('u-free', { courseId: 'c-1', lessonId: 'l-1' });
    expect(await repo.touchStream('u-free', s1)).toMatchObject({ ok: true });
    const s2 = await repo.startStream('u-free', { courseId: 'c-1', lessonId: 'l-2' });
    expect(await repo.touchStream('u-free', s1)).toEqual({ ok: false, reason: 'TAKEN' });
    expect(await repo.touchStream('u-free', s2)).toMatchObject({ ok: true });
  });
});
