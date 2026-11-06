/**
 * Startup Academy phase 6 — growth: incubator Pass seats (bulk tiers, mentors
 * on the full Pass price, monthly grants, reassignment), gifts (claim link,
 * mentors credited at claim, 30-day refund), bundles (admin price, mentors on
 * full list prices, owned courses not charged, per-course refunds), referral
 * (−10 % first purchase, 10 % back capped, after the refund window), subtitles
 * and the analytics counting each channel once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, type AcademyCourseRecord } from '@/server/db/store';
import {
  allocateBundle, quoteSeats, referralRewardDzd, seatDiscountRate, validSeatTiers, ACADEMY_DEFAULT_SEAT_TIERS,
} from '@/lib/academy';
import { parseVtt, serializeVtt } from '@/lib/vtt';
import { assignSeat, buySeats, grantDueSeatMonths, seatMonthWindow } from '@/server/academy/seats';
import { claimGift, giftForClaim, refundExpiredGifts, sendGiftLink, startGiftPurchase } from '@/server/academy/gifts';
import { createBundle, quoteBundle, startBundlePurchase, updateBundle } from '@/server/academy/bundles';
import { getOrCreateReferralCode } from '@/server/academy/referral';
import { refundEnrollment, releaseAcademyEarnings, startCoursePurchase } from '@/server/academy/orders';
import { startPassPurchase, settlePassMonths } from '@/server/academy/pass';
import { activePass } from '@/server/academy/pass-core';
import { getAcademyAnalytics } from '@/server/academy/analytics';
import { draftSubtitleTranslations, uploadSubtitle } from '@/server/academy/subtitles';
import { createMemoryAcademyRepo, setAcademyRepoForTests } from '@/server/academy/repo';
import { createMockVideoProvider } from '@/server/academy/video/mock';
import { setVideoProviderForTests } from '@/server/academy/video';

const repo = createMemoryAcademyRepo();
const NOW = '2026-11-02T10:00:00.000Z';
const DAY = 86_400_000;
const VIDEO = 'a'.repeat(32);

function user(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: `User ${id}`, phone: `+21355500${id.length}${id.charCodeAt(id.length - 1)}`, role: 'ENTREPRENEUR', status: 'ACTIVE',
    approvalStatus: 'APPROVED', membershipCode: null, membershipTier: 'EXPLORER', membershipExpiresAt: null, locale: 'fr',
    createdAt: NOW, updatedAt: NOW, ...extra,
  } as never;
}
const lesson = (id: string) => ({ id, title: { source: 'fr', fr: id }, description: null, kind: 'VIDEO', videoId: VIDEO, videoStatus: 'READY', durationSec: 100, isPreview: false, resources: [] });
function course(id: string, priceDzd: number, mentorId: string, extra: Partial<AcademyCourseRecord> = {}): AcademyCourseRecord {
  return {
    id, slug: id, fieldId: 'ideation', mentorIds: [mentorId], title: { source: 'fr', fr: id }, subtitle: null,
    description: { source: 'fr', fr: 'd' }, outcomes: [], level: 'BEGINNER', audioLanguage: 'DARIJA_FR', priceDzd, includedInPass: true,
    thumbnailUrl: null, trailerVideoId: null, status: 'PUBLISHED', createdBy: { kind: 'ADMIN', id: 'a' }, reviewNote: null,
    submittedAt: null, publishedAt: NOW, createdAt: NOW, updatedAt: NOW,
    modules: [{ id: `${id}-m`, title: { source: 'fr', fr: 'M' }, comingSoon: false, lessons: [lesson(`${id}-l1`), lesson(`${id}-l2`)] }],
    ...extra,
  } as AcademyCourseRecord;
}
const wallet = (id: string) => db.read().then((d) => d.wallets.find((w) => w.userId === id)?.balance ?? 0);
const getUser = (id: string) => db.read().then((d) => d.users.find((u) => u.id === id)!);
/** Mentor earnings recorded for one enrollment. */
const earnings = (enrollmentId: string) => db.read().then((d) => (d.mentorLedgerTxns ?? []).filter((t) => t.type === 'EARNING' && t.bookingId === `academy-${enrollmentId}`));
const common = { appBaseUrl: 'http://localhost:3000', locale: 'fr' };
let refN = 0;
const ref = () => `ref-${++refN}-xxxxxxxx`;

beforeEach(async () => {
  repo.reset();
  setAcademyRepoForTests(repo);
  setVideoProviderForTests(createMockVideoProvider());
  await db.update((d) => {
    d.users = [user('buyer'), user('friend'), user('manager', { role: 'INCUBATOR' }), user('investor', { role: 'INVESTOR' }), user('member1'), user('member2')];
    d.wallets = ['buyer', 'friend', 'manager', 'member1'].map((id, i) => ({ id: `w${i}`, userId: id, balance: id === 'manager' ? 500_000 : 20_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW })) as never;
    d.transactions = [];
    d.incubators = [{ id: 'inc-1', name: 'Hub Oran', managerId: 'manager' } as never];
    d.mentors = [{ id: 'm-1', fullName: 'Yacine', approvalStatus: 'APPROVED' } as never, { id: 'm-2', fullName: 'Nadia', approvalStatus: 'APPROVED', academyShareRate: 0.4 } as never];
    d.mentorWallets = [];
    d.mentorLedgerTxns = [];
    d.academyCourses = [course('c-a', 4000, 'm-1'), course('c-b', 6000, 'm-2'), course('c-draft', 3000, 'm-1', { status: 'DRAFT' })];
    d.academyEnrollments = [];
    d.academyOrders = [];
    d.academyPasses = [];
    d.academyGifts = [];
    d.academyBundles = [];
    d.academySeatBatches = [];
    d.academyReferrals = [];
    d.academySettings = null;
    d.notifications = [];
  });
});
afterEach(() => setVideoProviderForTests(null));

describe('pricing rules', () => {
  it('seat tiers, referral cap and bundle split', () => {
    expect(seatDiscountRate(9, ACADEMY_DEFAULT_SEAT_TIERS)).toBe(0);
    expect(seatDiscountRate(10, ACADEMY_DEFAULT_SEAT_TIERS)).toBe(0.1);
    expect(seatDiscountRate(40, ACADEMY_DEFAULT_SEAT_TIERS)).toBe(0.2);
    expect(quoteSeats(10, 3, 3500, ACADEMY_DEFAULT_SEAT_TIERS)).toMatchObject({ unitPriceDzd: 3150, amountDzd: 3150 * 30 });
    expect(validSeatTiers([{ minSeats: 10, discountRate: 0.1 }, { minSeats: 5, discountRate: 0.2 }])).toBe(false);
    expect(validSeatTiers([{ minSeats: 1, discountRate: 0.1 }])).toBe(false);
    expect(validSeatTiers([{ minSeats: 5, discountRate: 1 }])).toBe(false);
    expect(referralRewardDzd(2900)).toBe(290);
    expect(referralRewardDzd(33_600)).toBe(1000);
    expect(allocateBundle(8000, [4000, 6000])).toEqual([3200, 4800]);
    expect(allocateBundle(1001, [1, 1, 1]).reduce((s, x) => s + x, 0)).toBe(1001);
  });

  it('parses WebVTT (and SRT-style commas) and writes it back', () => {
    const cues = parseVtt('WEBVTT\n\nNOTE whisper\n\n1\n00:00:01,000 --> 00:00:03.500\nBonjour\n\n00:01:00.000 --> 00:01:02.000 align:start\nÇa va ?\n');
    expect(cues).toEqual([
      { start: '00:00:01.000', end: '00:00:03.500', settings: '', text: 'Bonjour' },
      { start: '00:01:00.000', end: '00:01:02.000', settings: 'align:start', text: 'Ça va ?' },
    ]);
    expect(parseVtt(serializeVtt(cues!))).toEqual(cues);
    expect(parseVtt('1\n00:00:01,000 --> 00:00:02,000\nno header')).toBeNull();
  });
});

describe('incubator seats', () => {
  it('only an incubator manager buys, at the tier price, from the incubator wallet, once per click', async () => {
    expect(await buySeats('buyer', { seats: 10, months: 2, clientReference: ref() })).toEqual({ ok: false, code: 'NOT_AN_INCUBATOR' });
    const r = ref();
    const res = await buySeats('manager', { seats: 10, months: 2, clientReference: r });
    expect(res.ok && res.batch).toMatchObject({ seats: 10, months: 2, unitListPriceDzd: 3500, unitPriceDzd: 3150, amountDzd: 63_000, discountRate: 0.1 });
    expect(await wallet('manager')).toBe(500_000 - 63_000);
    expect((await buySeats('manager', { seats: 10, months: 2, clientReference: r })).ok).toBe(true);
    expect(await wallet('manager')).toBe(500_000 - 63_000);
  });

  it('a member gets this month at once, on the full Pass price; reassigning keeps that month theirs', async () => {
    const res = await buySeats('manager', { seats: 2, months: 3, clientReference: ref() });
    if (!res.ok) throw new Error('setup');
    const [s1, s2] = res.batch.seatList;
    expect(await assignSeat('manager', res.batch.id, s1!.id, 'member1@x.dz')).toMatchObject({ ok: true });
    expect(await assignSeat('manager', res.batch.id, s2!.id, 'member1@x.dz')).toEqual({ ok: false, code: 'ALREADY_SEATED' });
    expect(await assignSeat('manager', res.batch.id, s2!.id, 'investor@x.dz')).toEqual({ ok: false, code: 'NOT_A_LEARNER' });
    expect(await assignSeat('manager', res.batch.id, s2!.id, 'nobody@x.dz')).toEqual({ ok: false, code: 'MEMBER_NOT_FOUND' });
    // Another incubator's manager cannot touch the seat.
    expect(await assignSeat('buyer', res.batch.id, s2!.id, 'member2@x.dz')).toEqual({ ok: false, code: 'NOT_FOUND' });

    let d = await db.read();
    const term = d.academyPasses!.find((p) => p.userId === 'member1')!;
    expect(term).toMatchObject({ method: 'SEAT', autoRenew: false, amountDzd: 3500, listPriceDzd: 3500 });
    expect(term.slices[0]!.baseDzd).toBe(3500);
    expect(activePass(d, 'member1')).not.toBeNull();

    // Reassign: member2 gets the next months, member1 keeps this one.
    await assignSeat('manager', res.batch.id, s1!.id, 'member2@x.dz');
    d = await db.read();
    expect(d.academyPasses!.filter((p) => p.userId === 'member2')).toHaveLength(0);
    expect(activePass(d, 'member1')).not.toBeNull();
    const nextMonth = new Date(Date.parse(seatMonthWindow(d.academySeatBatches![0]!, 1).start) - 3600_000);
    await grantDueSeatMonths(nextMonth);
    d = await db.read();
    const m2 = d.academyPasses!.find((p) => p.userId === 'member2')!;
    expect(m2.periodStart).toBe(seatMonthWindow(d.academySeatBatches![0]!, 1).start);
    expect((await grantDueSeatMonths(nextMonth)).granted).toBe(0);
  });

  it('a seat month is split between mentors by watch time on the FULL price', async () => {
    const res = await buySeats('manager', { seats: 10, months: 1, clientReference: ref() });
    if (!res.ok) throw new Error('setup');
    await assignSeat('manager', res.batch.id, res.batch.seatList[0]!.id, 'member1@x.dz');
    const term = (await db.read()).academyPasses![0]!;
    const day = new Date(Date.parse(term.periodStart) + 3600_000 + DAY).toISOString().slice(0, 10);
    await repo.addWatch({ userId: 'member1', lessonId: 'c-a-l1', courseId: 'c-a', mentorId: 'm-1', access: 'PASS', day, elapsedSec: 30, lessonDurationSec: 100 });
    await settlePassMonths(new Date(Date.parse(term.periodEnd) + DAY));
    const slice = (await db.read()).academyPasses![0]!.slices[0]!;
    expect(slice.lines).toEqual([expect.objectContaining({ mentorId: 'm-1', amountDzd: Math.round(3500 * 0.3) })]);
  });
});

describe('gifts', () => {
  it('a course gift is paid now and credits the mentor only when claimed (full price, withdrawable)', async () => {
    const res = await startGiftPurchase({ ...common, user: await getUser('buyer'), kind: 'COURSE', courseSlug: 'c-a', recipientName: 'Sara', recipientContact: 'friend@x.dz', message: 'Bravo !', method: 'WALLET', clientReference: ref() });
    expect(res).toMatchObject({ ok: true, state: 'PAID' });
    expect(await wallet('buyer')).toBe(20_000 - 4000);
    expect((await db.read()).mentorLedgerTxns).toHaveLength(0);
    const gift = (await db.read()).academyGifts![0]!;
    expect(gift).toMatchObject({ status: 'PAID', recipientName: 'Sara' });

    // Sending again issues a new link: the first one stops working.
    const old = await sendGiftLink(gift.id);
    const token = await sendGiftLink(gift.id);
    expect(old && token && old !== token).toBe(true);
    expect((await giftForClaim(old!, 'fr')).status).toBe('NOT_FOUND');
    expect(await giftForClaim(token!, 'fr')).toMatchObject({ status: 'CLAIMABLE', what: 'c-a', fromName: 'User buyer', message: 'Bravo !' });

    expect(await claimGift(token!, 'friend')).toEqual({ ok: true, kind: 'COURSE', courseSlug: 'c-a' });
    const d = await db.read();
    const e = d.academyEnrollments!.find((x) => x.userId === 'friend')!;
    expect(e).toMatchObject({ source: 'GIFT', pricePaidDzd: 4000 });
    expect(await earnings(e.id)).toEqual([expect.objectContaining({ mentorId: 'm-1', bucket: 'AVAILABLE' })]);
    expect(await claimGift(token!, 'member1')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect((await giftForClaim(token!, 'fr')).status).toBe('NOT_FOUND');
  });

  it('a Pass gift is one month that never renews; unclaimed after 30 days, the buyer is refunded', async () => {
    const res = await startGiftPurchase({ ...common, user: await getUser('buyer'), kind: 'PASS', recipientName: 'Sara', recipientContact: '0555 12 34 56', message: null, method: 'WALLET', clientReference: ref() });
    expect(res.ok).toBe(true);
    const token = await sendGiftLink((await db.read()).academyGifts![0]!.id);
    expect(await claimGift(token!, 'friend')).toMatchObject({ ok: true, kind: 'PASS' });
    expect((await db.read()).academyPasses![0]).toMatchObject({ userId: 'friend', method: 'GIFT', autoRenew: false });

    await startGiftPurchase({ ...common, user: await getUser('buyer'), kind: 'COURSE', courseSlug: 'c-b', recipientName: 'X', recipientContact: 'x@x.dz', message: null, method: 'WALLET', clientReference: ref() });
    const before = await wallet('buyer');
    const gift = (await db.read()).academyGifts!.find((g) => g.courseId === 'c-b')!;
    const late = new Date(Date.now() + 31 * DAY);
    expect(await refundExpiredGifts(late)).toEqual({ refunded: 1 });
    expect(await refundExpiredGifts(late)).toEqual({ refunded: 0 });
    expect(await wallet('buyer')).toBe(before + 6000);
    expect((await db.read()).academyGifts!.find((g) => g.id === gift.id)!.status).toBe('REFUNDED');
    expect(await sendGiftLink(gift.id)).toBeNull();
  });

  it('refuses a bad contact and a non-buyer', async () => {
    expect(await startGiftPurchase({ ...common, user: await getUser('buyer'), kind: 'PASS', recipientName: 'X', recipientContact: 'abc', message: null, method: 'WALLET', clientReference: ref() })).toEqual({ ok: false, code: 'BAD_CONTACT' });
    expect(await startGiftPurchase({ ...common, user: await getUser('investor'), kind: 'PASS', recipientName: 'X', recipientContact: 'x@x.dz', message: null, method: 'WALLET', clientReference: ref() })).toEqual({ ok: false, code: 'NOT_A_BUYER' });
  });
});

describe('bundles', () => {
  const input = { title: { source: 'fr' as const, fr: 'Lancer sa startup' }, description: null, courseIds: ['c-a', 'c-b'], priceDzd: 8000 };

  it('checks the courses and the price floor (the mentors’ shares)', async () => {
    expect(await createBundle({ ...input, courseIds: ['c-a', 'c-draft'] })).toEqual({ ok: false, code: 'COURSE_NOT_PUBLISHED' });
    expect(await createBundle({ ...input, priceDzd: 11_000 })).toEqual({ ok: false, code: 'PRICE_INVALID' });
    // Mentors earn 30 % × 4 000 + 40 % × 6 000 = 3 600: below that is refused.
    await db.update((d) => { d.academyCourses!.find((c) => c.id === 'c-b')!.priceDzd = 60_000; d.mentors.find((m) => m.id === 'm-2')!.academyShareRate = 0.9; });
    expect(await createBundle({ ...input, priceDzd: 50_000 })).toEqual({ ok: false, code: 'PRICE_BELOW_SHARES' });
  });

  it('buying enrolls each course with its part of the price; mentors earn on full list prices; refunds go course by course', async () => {
    const b = await createBundle(input);
    if (!b.ok) throw new Error('setup');
    await updateBundle(b.bundle.id, { ...input, status: 'PUBLISHED' });
    const res = await startBundlePurchase({ ...common, user: await getUser('buyer'), bundleSlug: b.bundle.slug, method: 'WALLET', clientReference: ref() });
    expect(res).toMatchObject({ ok: true, state: 'PAID' });
    expect(await wallet('buyer')).toBe(20_000 - 8000);
    const d = await db.read();
    const ea = d.academyEnrollments!.find((e) => e.courseId === 'c-a')!;
    const eb = d.academyEnrollments!.find((e) => e.courseId === 'c-b')!;
    expect([ea.pricePaidDzd, eb.pricePaidDzd]).toEqual([3200, 4800]);
    const [earnA] = await earnings(ea.id);
    const [earnB] = await earnings(eb.id);
    expect(earnA!.amount).toBe(Math.round(4000 * 0.3));
    expect(earnB!.amount).toBe(Math.round(6000 * 0.4));

    // Refunding one course voids only its mentor's held earning.
    expect(await refundEnrollment('buyer', ea.id)).toEqual({ ok: true, amountDzd: 3200 });
    const after = await db.read();
    expect((after.mentorLedgerTxns ?? []).some((t) => t.bookingId === `academy-${ea.id}` && t.status === 'REVERSED')).toBe(true);
    expect(await releaseAcademyEarnings(new Date(Date.now() + 8 * DAY))).toMatchObject({ released: 1 });
  });

  it('a course already owned is not charged: the price scales down by its weight', async () => {
    const b = await createBundle(input);
    if (!b.ok) throw new Error('setup');
    await updateBundle(b.bundle.id, { ...input, status: 'PUBLISHED' });
    await startCoursePurchase({ ...common, user: await getUser('buyer'), courseSlug: 'c-a', method: 'WALLET', clientReference: ref() });
    const q = await quoteBundle(await getUser('buyer'), b.bundle.slug);
    expect(q.ok && q.quote).toMatchObject({ ownedCourseIds: ['c-a'], amountDzd: 4800 });
    expect(q.ok && q.quote.items.map((i) => i.courseId)).toEqual(['c-b']);
  });
});

describe('referral', () => {
  it('the new member gets 10 % off their first purchase; the referrer 10 % back after 7 days', async () => {
    const code = await getOrCreateReferralCode('buyer');
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await getOrCreateReferralCode('buyer')).toBe(code);

    const res = await startCoursePurchase({ ...common, user: await getUser('friend'), courseSlug: 'c-a', method: 'WALLET', clientReference: ref(), referralCode: code });
    expect(res.ok).toBe(true);
    let d = await db.read();
    const order = d.academyOrders![0]!;
    expect(order).toMatchObject({ amountDzd: 3600, listPriceDzd: 4000, referral: { referrerId: 'buyer', discountDzd: 400 } });
    // The mentor's share stays on the full price.
    const e = d.academyEnrollments![0]!;
    expect((await earnings(e.id))[0]!.amount).toBe(1200);
    expect(d.academyReferrals).toEqual([expect.objectContaining({ referrerId: 'buyer', refereeId: 'friend', status: 'PENDING', rewardDzd: 360 })]);

    // A second purchase gets no discount.
    await startCoursePurchase({ ...common, user: await getUser('friend'), courseSlug: 'c-b', method: 'WALLET', clientReference: ref(), referralCode: code });
    d = await db.read();
    const second = d.academyOrders!.find((o) => o.courseId === 'c-b')!;
    expect(second.amountDzd).toBe(6000);
    expect(second.referral).toBeUndefined();

    const before = await wallet('buyer');
    expect((await releaseAcademyEarnings(new Date(Date.now() + 6 * DAY))).referrals).toEqual({ credited: 0, voided: 0 });
    expect((await releaseAcademyEarnings(new Date(Date.now() + 8 * DAY))).referrals).toEqual({ credited: 1, voided: 0 });
    expect(await wallet('buyer')).toBe(before + 360);
    expect((await db.read()).transactions.find((t) => t.reference.startsWith('academy-referral-'))!.type).toBe('ADJUSTMENT');
    expect((await releaseAcademyEarnings(new Date(Date.now() + 9 * DAY))).referrals.credited).toBe(0);
  });

  it('no discount for yourself or the same phone; a refunded first purchase voids the reward; the reward is capped', async () => {
    const code = await getOrCreateReferralCode('buyer');
    await startCoursePurchase({ ...common, user: await getUser('buyer'), courseSlug: 'c-a', method: 'WALLET', clientReference: ref(), referralCode: code });
    expect((await db.read()).academyOrders![0]!.referral).toBeUndefined();

    await db.update((d) => { d.users.find((u) => u.id === 'member1')!.phone = (d.users.find((u) => u.id === 'buyer')!.phone ?? '').replace('+213', '0'); });
    await startCoursePurchase({ ...common, user: await getUser('member1'), courseSlug: 'c-a', method: 'WALLET', clientReference: ref(), referralCode: code });
    expect((await db.read()).academyOrders!.find((o) => o.userId === 'member1')!.referral).toBeUndefined();

    await startCoursePurchase({ ...common, user: await getUser('friend'), courseSlug: 'c-a', method: 'WALLET', clientReference: ref(), referralCode: code });
    const e = (await db.read()).academyEnrollments!.find((x) => x.userId === 'friend')!;
    await refundEnrollment('friend', e.id);
    expect((await releaseAcademyEarnings(new Date(Date.now() + 8 * DAY))).referrals).toEqual({ credited: 0, voided: 1 });

    // An annual Pass (28 000 DA after −10 %) rewards 1 000 DA, not 2 800.
    await db.update((d) => { d.wallets.push({ id: 'w9', userId: 'member2', balance: 50_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never); });
    const pass = await startPassPurchase({ ...common, user: await getUser('member2'), plan: 'ANNUAL', method: 'WALLET', clientReference: ref(), referralCode: code });
    expect(pass).toMatchObject({ ok: true });
    expect((await db.read()).academyReferrals!.find((r) => r.refereeId === 'member2')!.rewardDzd).toBe(1000);
  });
});

describe('analytics count each channel once', () => {
  it('seat and gift months are not Pass revenue; bundles keep what was not refunded', async () => {
    const seats = await buySeats('manager', { seats: 1, months: 1, clientReference: ref() });
    if (!seats.ok) throw new Error('setup');
    await assignSeat('manager', seats.batch.id, seats.batch.seatList[0]!.id, 'member1@x.dz');
    await startGiftPurchase({ ...common, user: await getUser('buyer'), kind: 'PASS', recipientName: 'S', recipientContact: 's@x.dz', message: null, method: 'WALLET', clientReference: ref() });
    const token = await sendGiftLink((await db.read()).academyGifts![0]!.id);
    await claimGift(token!, 'friend');
    const a = await getAcademyAnalytics('fr');
    expect(a.pass.revenueDzd).toBe(0);
    expect(a.seats).toMatchObject({ batches: 1, seatsSold: 1, seatsAssigned: 1, revenueDzd: 3500 });
    expect(a.gifts).toMatchObject({ paid: 1, claimed: 1, revenueDzd: 3500 });
  });
});

describe('subtitles', () => {
  const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBonjour à tous\n\n00:00:04.000 --> 00:00:06.000\nOn commence\n';

  it('uploads the author’s file, drafts the two other languages with timings kept, never overwrites the author’s', async () => {
    expect(await uploadSubtitle('c-a', 'c-a-l1', 'fr', 'not a vtt')).toEqual({ ok: false, code: 'INVALID_VTT' });
    expect(await draftSubtitleTranslations('c-a', 'c-a-l1')).toEqual({ ok: false, code: 'NO_SOURCE' });
    expect(await uploadSubtitle('c-a', 'c-a-l1', 'fr', VTT)).toEqual({ ok: true, cues: 2 });
    const res = await draftSubtitleTranslations('c-a', 'c-a-l1', async ({ lines, target }) => lines.map((l) => `[${target}] ${l}`));
    expect(res).toEqual({ ok: true, drafted: ['en', 'ar'] });
    const tracks = (await db.read()).academyCourses![0]!.modules[0]!.lessons[0]!.subtitles!;
    expect(tracks.map((t) => [t.lang, t.drafted]).sort()).toEqual([['ar', true], ['en', true], ['fr', false]]);
    const en = await repo.getSubtitle('c-a-l1', 'en');
    expect(parseVtt(en!.vtt)![0]).toEqual({ start: '00:00:01.000', end: '00:00:03.000', settings: '', text: '[en] Bonjour à tous' });
    // The author fixes English: it is theirs now, and a new draft leaves it alone.
    await uploadSubtitle('c-a', 'c-a-l1', 'en', VTT.replace('Bonjour à tous', 'Hello everyone'));
    expect(await draftSubtitleTranslations('c-a', 'c-a-l1', async ({ lines }) => lines)).toEqual({ ok: true, drafted: ['ar'] });
    expect(parseVtt((await repo.getSubtitle('c-a-l1', 'en'))!.vtt)![0]!.text).toBe('Hello everyone');
  });
});

describe('phone matching', () => {
  it('treats +213 0555…, 0555… and 555… as the same number', async () => {
    const { nationalDigits } = await import('@/server/academy/seats');
    expect(nationalDigits('+213 0700 00 00 04')).toBe('700000004');
    expect(nationalDigits('07 00 00 00 04')).toBe('700000004');
    expect(nationalDigits('+213700000004')).toBe('700000004');
  });
});
