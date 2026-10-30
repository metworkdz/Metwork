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
  const revenuePass = passTerms.reduce((s, p) => s + p.amountDzd, 0);
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
      thisMonthDzd: passTerms.filter((p) => p.createdAt.startsWith(month)).reduce((s, p) => s + p.amountDzd, 0),
    },
    mentors: {
      earnedDzd,
      heldDzd: earned.filter((t) => t.bucket === 'PENDING' && !released.has(t.bookingId)).reduce((s, t) => s + t.amount, 0),
      paidOutDzd: earned.filter((t) => t.bucket === 'AVAILABLE' || released.has(t.bookingId)).reduce((s, t) => s + t.amount, 0),
    },
    discountsAbsorbedDzd: kept.reduce((s, o) => s + (o.listPriceDzd - o.amountDzd), 0) + passTerms.reduce((s, p) => s + (p.listPriceDzd - p.amountDzd), 0),
    metworkNetDzd: revenueCourses + revenuePass - earnedDzd,
    passHoursThisMonth: Math.round(passSeconds / 360) / 10,
    topCourses: [...byCourse.entries()]
      .sort((a, b) => b[1].revenueDzd - a[1].revenueDzd)
      .slice(0, 5)
      .map(([id, r]) => {
        const c = d.academyCourses?.find((x) => x.id === id);
        return { title: c ? resolveText(c.title, locale) : id, ...r };
      }),
  };
}
