/**
 * Startup Academy numbers for the admin Analytics page (owner decision 3: all
 * Academy analytics live there). Read-only; everything from the store plus the
 * month's Pass watch time from Postgres.
 */
import { db } from '@/server/db/store';
import { resolveText } from '@/lib/localized-text';
import { algiersDay } from '@/lib/academy';
import { academyRepo } from './repo';

export interface AcademyAnalytics {
  courses: { published: number; drafts: number };
  sales: { count: number; revenueDzd: number; thisMonthCount: number; thisMonthDzd: number; refundedCount: number; refundedDzd: number };
  pass: { activeMonthly: number; activeAnnual: number; mrrDzd: number; revenueDzd: number; thisMonthDzd: number };
  mentors: { earnedDzd: number; heldDzd: number; paidOutDzd: number };
  discountsAbsorbedDzd: number;
  metworkNetDzd: number;
  passHoursThisMonth: number;
  topCourses: { title: string; sales: number; revenueDzd: number }[];
  /** Phase 6 growth channels. */
  seats: { batches: number; seatsSold: number; seatsAssigned: number; revenueDzd: number };
  gifts: { paid: number; claimed: number; waiting: number; refunded: number; revenueDzd: number };
  bundles: { sales: number; revenueDzd: number };
  referrals: { count: number; pending: number; rewardsPaidDzd: number; discountsDzd: number };
  learning: { certificates: number; averageRating: number | null; reviews: number };
}

export async function getAcademyAnalytics(locale: string, now = new Date()): Promise<AcademyAnalytics> {
  const d = await db.read();
  const month = now.toISOString().slice(0, 7);
  const orders = (d.academyOrders ?? []).filter((o) => o.status === 'PAID' && !o.duplicateRefunded);
  const courseOrders = orders.filter((o) => (o.kind ?? 'COURSE') === 'COURSE');
  const enrollments = d.academyEnrollments ?? [];
  const refunded = enrollments.filter((e) => e.source === 'PURCHASE' && e.refundedAt);
  const refundedIds = new Set(refunded.map((e) => e.paymentRef));

  const kept = courseOrders.filter((o) => !refundedIds.has(o.id));
  const passTerms = d.academyPasses ?? [];
  const nowIso = now.toISOString();
  const active = passTerms.filter((p) => p.status === 'ACTIVE' && p.periodStart <= nowIso && nowIso < p.periodEnd);

  const ledger = (d.mentorLedgerTxns ?? []).filter((t) => t.type === 'EARNING' && (t.bookingId ?? '').startsWith('academy-'));
  const earned = ledger.filter((t) => t.status !== 'REVERSED');
  const released = new Set((d.mentorLedgerTxns ?? []).filter((t) => t.type === 'RELEASE' && (t.bookingId ?? '').startsWith('academy-')).map((t) => t.bookingId));

  const revenueCourses = kept.reduce((s, o) => s + o.amountDzd, 0);
  // Seat and gifted months are counted with the seats and the gifts, where their money came in.
  const boughtTerms = passTerms.filter((p) => p.method !== 'SEAT' && p.method !== 'GIFT');
  const revenuePass = boughtTerms.reduce((s, p) => s + p.amountDzd, 0);

  const batches = d.academySeatBatches ?? [];
  const revenueSeats = batches.reduce((s, b) => s + b.amountDzd, 0);
  const gifts = (d.academyGifts ?? []).filter((g) => g.status === 'PAID' || g.status === 'CLAIMED' || g.status === 'REFUNDED');
  const revenueGifts = gifts.filter((g) => g.status !== 'REFUNDED').reduce((s, g) => s + g.amountDzd, 0);
  // A bundle keeps what was not refunded course by course (or returned for an owned course).
  const bundleOrders = (d.academyOrders ?? []).filter((o) => o.status === 'PAID' && o.kind === 'BUNDLE');
  const bundleRevenueOf = (o: (typeof bundleOrders)[number]) => {
    const enrolled = enrollments.filter((e) => e.paymentRef === o.id);
    return enrolled.filter((e) => !e.refundedAt).reduce((s, e) => s + e.pricePaidDzd, 0);
  };
  const revenueBundles = bundleOrders.reduce((s, o) => s + bundleRevenueOf(o), 0);
  const referrals = d.academyReferrals ?? [];
  const rewardsPaid = referrals.filter((r) => r.status === 'CREDITED').reduce((s, r) => s + r.rewardDzd, 0);
  const visibleReviews = (d.academyReviews ?? []).filter((r) => !r.hiddenAt);
  const earnedDzd = earned.reduce((s, t) => s + t.amount, 0);

  const byCourse = new Map<string, { sales: number; revenueDzd: number }>();
  for (const o of kept) {
    const r = byCourse.get(o.courseId) ?? { sales: 0, revenueDzd: 0 };
    r.sales++; r.revenueDzd += o.amountDzd;
    byCourse.set(o.courseId, r);
  }

  let passSeconds = 0;
  try {
    const totals = await academyRepo().watchTotals(`${month}-01`, algiersDay(now), 'PASS');
    passSeconds = totals.reduce((s, t) => s + t.seconds, 0);
  } catch { /* Postgres unavailable: show 0 rather than break the page */ }

  return {
    courses: {
      published: (d.academyCourses ?? []).filter((c) => c.status === 'PUBLISHED').length,
      drafts: (d.academyCourses ?? []).filter((c) => c.status === 'DRAFT' || c.status === 'IN_REVIEW').length,
    },
    sales: {
      count: kept.length,
      revenueDzd: revenueCourses,
      thisMonthCount: kept.filter((o) => (o.paidAt ?? '').startsWith(month)).length,
      thisMonthDzd: kept.filter((o) => (o.paidAt ?? '').startsWith(month)).reduce((s, o) => s + o.amountDzd, 0),
      refundedCount: refunded.length,
      refundedDzd: refunded.reduce((s, e) => s + e.pricePaidDzd, 0),
    },
    pass: {
      activeMonthly: new Set(active.filter((p) => p.plan === 'MONTHLY').map((p) => p.userId)).size,
      activeAnnual: new Set(active.filter((p) => p.plan === 'ANNUAL').map((p) => p.userId)).size,
      mrrDzd: Math.round(active.reduce((s, p) => s + (p.plan === 'ANNUAL' ? p.amountDzd / 12 : p.amountDzd), 0)),
      revenueDzd: revenuePass,
      thisMonthDzd: boughtTerms.filter((p) => p.createdAt.startsWith(month)).reduce((s, p) => s + p.amountDzd, 0),
    },
    mentors: {
      earnedDzd,
      heldDzd: earned.filter((t) => t.bucket === 'PENDING' && !released.has(t.bookingId)).reduce((s, t) => s + t.amount, 0),
      paidOutDzd: earned.filter((t) => t.bucket === 'AVAILABLE' || released.has(t.bookingId)).reduce((s, t) => s + t.amount, 0),
    },
    discountsAbsorbedDzd: kept.reduce((s, o) => s + (o.listPriceDzd - o.amountDzd), 0) + passTerms.reduce((s, p) => s + (p.listPriceDzd - p.amountDzd), 0),
    metworkNetDzd: revenueCourses + revenuePass + revenueSeats + revenueGifts + revenueBundles - earnedDzd - rewardsPaid,
    passHoursThisMonth: Math.round(passSeconds / 360) / 10,
    topCourses: [...byCourse.entries()]
      .sort((a, b) => b[1].revenueDzd - a[1].revenueDzd)
      .slice(0, 5)
      .map(([id, r]) => {
        const c = d.academyCourses?.find((x) => x.id === id);
        return { title: c ? resolveText(c.title, locale) : id, ...r };
      }),
    seats: {
      batches: batches.length,
      seatsSold: batches.reduce((s, b) => s + b.seats, 0),
      seatsAssigned: batches.reduce((s, b) => s + b.seatList.filter((x) => x.holderUserId).length, 0),
      revenueDzd: revenueSeats,
    },
    gifts: {
      paid: gifts.length,
      claimed: gifts.filter((g) => g.status === 'CLAIMED').length,
      waiting: gifts.filter((g) => g.status === 'PAID').length,
      refunded: gifts.filter((g) => g.status === 'REFUNDED').length,
      revenueDzd: revenueGifts,
    },
    bundles: { sales: bundleOrders.length, revenueDzd: revenueBundles },
    referrals: {
      count: referrals.length,
      pending: referrals.filter((r) => r.status === 'PENDING').length,
      rewardsPaidDzd: rewardsPaid,
      discountsDzd: (d.academyOrders ?? []).filter((o) => o.status === 'PAID' && o.referral).reduce((s, o) => s + (o.referral?.discountDzd ?? 0), 0),
    },
    learning: {
      certificates: (d.academyCertificates ?? []).filter((c) => !c.revokedAt).length,
      reviews: visibleReviews.length,
      averageRating: visibleReviews.length ? Math.round((visibleReviews.reduce((s, r) => s + r.rating, 0) / visibleReviews.length) * 10) / 10 : null,
    },
  };
}
