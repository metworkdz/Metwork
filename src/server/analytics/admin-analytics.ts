/**
 * Admin benefit & pricing analytics, computed straight from the store.
 *
 * Shared by `GET /api/admin/analytics` and the analytics page. The page must
 * call this directly: it used to fetch its own API over HTTP without the
 * admin's session cookie, got a 401 and silently rendered all zeros.
 */
import { db } from '@/server/db/store';
import { resolveMemberBenefits } from '@/server/memberships/service';

/**
 * Membership prices as they stood BEFORE `basePrice` was frozen onto every
 * purchase transaction. HISTORICAL VALUATION ONLY — never a live price.
 *
 * Purchases made since carry the exact amount they were charged in their
 * metadata; only rows older than that need this table to value their promo
 * discount, and the figure it gives is the one that was true when the row was
 * written. It lives here, next to its single consumer, rather than in the
 * membership service — where it read like a current price table and could
 * disagree with the admin-editable config.
 */
const LEGACY_MEMBERSHIP_PRICES: Record<
  string,
  { monthly: number; semesterly: number; yearly: number }
> = {
  ENTREPRENEUR: { monthly: 3_500, semesterly: 3_500 * 6, yearly: Math.round(3_500 * 12 * 0.7) },
  STARTUP:      { monthly: 6_500, semesterly: 6_500 * 6, yearly: Math.round(6_500 * 12 * 0.7) },
};

export async function buildAdminAnalytics() {
  const data = await db.read();
  const now = new Date();

  // ── Helpers ────────────────────────────────────────────────────────────────

  const thisYear  = now.getUTCFullYear();
  const thisMonth = `${thisYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const yearStart = `${thisYear}-01-01T00:00:00.000Z`;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  function monthKey(iso: string): string {
    return iso.slice(0, 7); // 'YYYY-MM'
  }

  // ── 0. User demographics ───────────────────────────────────────────────────

  const allRealUsers   = data.users.filter((u) => u.role !== 'ADMIN');
  const maleCount      = allRealUsers.filter((u) => (u as { sex?: string }).sex === 'MALE').length;
  const femaleCount    = allRealUsers.filter((u) => (u as { sex?: string }).sex === 'FEMALE').length;
  const unknownCount   = allRealUsers.length - maleCount - femaleCount;
  const totalWithSex   = maleCount + femaleCount;
  const malePct        = totalWithSex > 0 ? Math.round((maleCount   / totalWithSex) * 100) : 0;
  const femalePct      = totalWithSex > 0 ? Math.round((femaleCount / totalWithSex) * 100) : 0;

  // Per-role breakdown
  const roleBreakdown: Record<string, { total: number; male: number; female: number; unknown: number }> = {};
  for (const u of allRealUsers) {
    const r = u.role;
    if (!roleBreakdown[r]) roleBreakdown[r] = { total: 0, male: 0, female: 0, unknown: 0 };
    roleBreakdown[r]!.total++;
    const s = (u as { sex?: string }).sex;
    if (s === 'MALE')        roleBreakdown[r]!.male++;
    else if (s === 'FEMALE') roleBreakdown[r]!.female++;
    else                     roleBreakdown[r]!.unknown++;
  }

  // ── 1. Membership stats ─────────────────────────────────────────────────────

  // Active right now (not expired)
  const activeUsers = data.users.filter((u) => {
    if (!u.membershipCode && !u.membershipTier) return false;
    const expired =
      u.membershipExpiresAt && new Date(u.membershipExpiresAt) <= now;
    if (expired) return false;
    const code = u.membershipCode ?? '';
    const tier = u.membershipTier ?? '';
    return (
      code === 'ENTREPRENEUR' || code === 'STARTUP' ||
      tier === 'BUILDER'     || tier === 'FOUNDER'
    );
  });

  const activeBuilder = activeUsers.filter(
    (u) => u.membershipCode === 'ENTREPRENEUR' || u.membershipTier === 'BUILDER',
  ).length;
  const activeFounder = activeUsers.filter(
    (u) => u.membershipCode === 'STARTUP' || u.membershipTier === 'FOUNDER',
  ).length;

  // All membership purchase transactions
  const membershipTxns = (data.transactions ?? []).filter(
    (t) =>
      t.type === 'PAYMENT' &&
      t.status === 'COMPLETED' &&
      (t.metadata as { membershipPlan?: string } | null)?.membershipPlan != null,
  );

  const membershipRevenue = membershipTxns.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0,
  );
  const membershipRevenueThisMonth = membershipTxns
    .filter((t) => monthKey(t.createdAt) === thisMonth)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Discounts given on membership purchases
  let membershipDiscountTotal = 0;
  let membershipPurchasesWithDiscount = 0;
  for (const t of membershipTxns) {
    const meta = t.metadata as {
      membershipPlan?: string;
      billingPeriod?: string;
      discountPercent?: number;
      basePrice?: number;
    } | null;
    if (!meta?.discountPercent || meta.discountPercent === 0) continue;
    // Purchases made after the repricing carry the price they were actually
    // charged on. Older rows have no basePrice, so fall back to the legacy
    // price table — the only figure that was true when they were written.
    let base = meta.basePrice;
    if (base == null) {
      const prices = LEGACY_MEMBERSHIP_PRICES[meta.membershipPlan ?? ''];
      if (!prices) continue;
      // Was reading `prices.monthly` for semesterly rows, understating every
      // semesterly discount by a factor of six.
      base = meta.billingPeriod === 'yearly' ? prices.yearly : prices.semesterly;
    }
    membershipDiscountTotal += Math.floor((base * meta.discountPercent) / 100);
    membershipPurchasesWithDiscount++;
  }

  // ── 2. Free consultation sessions ─────────────────────────────────────────

  const freeSessions = (data.mentorConsultations ?? []).filter(
    (c) => c.chargeType === 'FREE_QUOTA',
  );
  const freeSessionsThisMonth = freeSessions.filter(
    (c) => monthKey(c.createdAt) === thisMonth,
  );

  // Estimated value: mentor's hourly fee × session duration
  function sessionValue(c: { mentorId: string; durationMinutes?: number | null }): number {
    const mentor = (data.mentors ?? []).find((m) => m.id === c.mentorId);
    const fee    = (mentor as { consultationFee?: number } | undefined)?.consultationFee ?? 0;
    const mins   = c.durationMinutes ?? 60;
    return fee > 0 ? Math.round((mins / 60) * fee) : 0;
  }

  const freeSessionValue         = freeSessions.reduce((s, c) => s + sessionValue(c), 0);
  const freeSessionValueThisMonth = freeSessionsThisMonth.reduce((s, c) => s + sessionValue(c), 0);

  // Per-mentor breakdown
  const mentorMap = new Map<string, { name: string; count: number; value: number }>();
  for (const c of freeSessions) {
    const mentor = (data.mentors ?? []).find((m) => m.id === c.mentorId);
    const name   = (mentor as { fullName?: string } | undefined)?.fullName ?? c.mentorId;
    const prev   = mentorMap.get(c.mentorId) ?? { name, count: 0, value: 0 };
    mentorMap.set(c.mentorId, {
      name,
      count: prev.count + 1,
      value: prev.value + sessionValue(c),
    });
  }
  const byMentor = Array.from(mentorMap.values()).sort((a, b) => b.count - a.count);

  // Paid sessions (for comparison). Instant-book consultations only exist as
  // mentorBookings (no mentorConsultations credit row is written for them), so
  // read both and de-duplicate on the booking id. Refunded sessions are not revenue.
  const refundedBookingIds = new Set(
    (data.refundRequests ?? [])
      .filter((r) => r.sourceKind === 'MENTOR_BOOKING' && r.status === 'REFUNDED')
      .map((r) => r.sourceId),
  );
  const paidFromBookings = (data.mentorBookings ?? []).filter(
    (b) =>
      b.chargeType === 'PAID' &&
      b.paymentStatus === 'PAID' &&
      !b.refundTransactionId &&
      !refundedBookingIds.has(b.id),
  );
  const seenBookingIds = new Set(paidFromBookings.map((b) => b.id));
  const paidSessions = [
    ...paidFromBookings.map((b) => ({ amountCharged: b.amountCharged ?? 0 })),
    ...(data.mentorConsultations ?? [])
      .filter(
        (c) =>
          c.chargeType === 'PAID' &&
          !(c.bookingId && (seenBookingIds.has(c.bookingId) || refundedBookingIds.has(c.bookingId))),
      )
      .map((c) => ({ amountCharged: c.amountCharged ?? 0 })),
  ];
  const paidSessionRevenue = paidSessions.reduce((s, c) => s + c.amountCharged, 0);

  // ── 3. Network Pass sessions ────────────────────────────────────────────────

  const allVisits        = (data.networkVisits ?? []);
  const checkedInVisits  = allVisits.filter((v) => v.checkedInAt != null);
  const visitsThisMonth  = checkedInVisits.filter(
    (v) => (v.checkedInAt ?? '') >= monthStart,
  );

  // Credit utilisation this month — sum of networkCreditsMax for active Builder/Founder users
  const totalCreditsIssuedThisMonth = activeUsers.reduce(
    (s, u) => s + (u.networkCreditsMax ?? 0),
    0,
  );
  const creditsUsedThisMonth = visitsThisMonth.length;
  const utilizationRate =
    totalCreditsIssuedThisMonth > 0
      ? Math.round((creditsUsedThisMonth / totalCreditsIssuedThisMonth) * 100)
      : 0;

  // Per-space breakdown
  const spaceVisitMap = new Map<string, { name: string; count: number }>();
  for (const v of checkedInVisits) {
    const space = (data.spaces ?? []).find((s) => s.id === v.spaceId);
    const name  = (space as { name?: string } | undefined)?.name ?? v.spaceId;
    const prev  = spaceVisitMap.get(v.spaceId) ?? { name, count: 0 };
    spaceVisitMap.set(v.spaceId, { name, count: prev.count + 1 });
  }
  const bySpace = Array.from(spaceVisitMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

  // ── 4. Space booking membership discounts ──────────────────────────────────
  //
  // Every paid plan grants a space discount, and each MEMBER's rate is their
  // own: `resolveMemberBenefits` reads their frozen snapshot before the live
  // config, so a grandfathered member is valued at the rate they actually
  // bought. This used to assume "Founder, 20 %" for everyone — which ignored
  // Entrepreneur members entirely and over-stated every remaining booking once
  // the live space rate became 15 %.
  //
  // `totalAmount` is stored POST-discount, so the amount forgone on a booking
  // discounted at rate r is  totalAmount × r / (1 − r).
  const spaceDiscountRateByUser = new Map<string, number>();
  for (const u of data.users) {
    const rate = resolveMemberBenefits(data, u).spaceDiscountRate;
    if (rate > 0 && rate < 1) spaceDiscountRateByUser.set(u.id, rate);
  }

  /** DZD forgone on one wallet-paid space booking, or 0 when it carried no discount. */
  function spaceDiscountGiven(b: { userId?: string | null; totalAmount: number }): number {
    const rate = b.userId ? spaceDiscountRateByUser.get(b.userId) : undefined;
    if (!rate) return 0;
    return Math.round((b.totalAmount * rate) / (1 - rate));
  }

  const isDiscountableSpaceBooking = (b: {
    userId?: string | null;
    paymentMethod?: string | null;
    itemKind?: string;
    status?: string;
  }): boolean =>
    b.userId != null &&
    spaceDiscountRateByUser.has(b.userId) &&
    b.paymentMethod === 'wallet' &&
    b.itemKind === 'SPACE' &&
    b.status !== 'CANCELLED';

  const membershipSpaceDiscountEstimate = (data.bookings ?? [])
    .filter(isDiscountableSpaceBooking)
    .reduce((s, b) => s + spaceDiscountGiven(b), 0);

  // ── 5. Month-by-month trend (current year) ─────────────────────────────────

  const monthlyTrend: Record<
    string,
    { membershipRevenue: number; freeSessions: number; networkPassSessions: number; spaceDiscount: number }
  > = {};

  // Initialise all months of current year
  for (let m = 1; m <= 12; m++) {
    const key = `${thisYear}-${String(m).padStart(2, '0')}`;
    monthlyTrend[key] = { membershipRevenue: 0, freeSessions: 0, networkPassSessions: 0, spaceDiscount: 0 };
  }

  for (const t of membershipTxns) {
    const k = monthKey(t.createdAt);
    if (t.createdAt >= yearStart && monthlyTrend[k]) {
      monthlyTrend[k]!.membershipRevenue += Math.abs(t.amount);
    }
  }
  for (const c of freeSessions) {
    const k = monthKey(c.createdAt);
    if (c.createdAt >= yearStart && monthlyTrend[k]) {
      monthlyTrend[k]!.freeSessions += 1;
    }
  }
  for (const v of checkedInVisits) {
    const k = monthKey(v.checkedInAt!);
    if (v.checkedInAt! >= yearStart && monthlyTrend[k]) {
      monthlyTrend[k]!.networkPassSessions += 1;
    }
  }
  // Same per-member valuation as the all-time figure, bucketed by month.
  for (const b of (data.bookings ?? [])) {
    if (isDiscountableSpaceBooking(b) && b.createdAt >= yearStart) {
      const k = monthKey(b.createdAt);
      if (monthlyTrend[k]) {
        monthlyTrend[k]!.spaceDiscount += spaceDiscountGiven(b);
      }
    }
  }

  // ── Response ───────────────────────────────────────────────────────────────

  return {
    generatedAt: now.toISOString(),
    demographics: {
      totalUsers:   allRealUsers.length,
      maleCount,
      femaleCount,
      unknownCount,
      malePct,
      femalePct,
      byRole: roleBreakdown,
    },
    memberships: {
      activeBuilder,
      activeFounder,
      activeTotal: activeBuilder + activeFounder,
      revenue: {
        total: membershipRevenue,
        thisMonth: membershipRevenueThisMonth,
        discountTotal: membershipDiscountTotal,
        purchasesWithDiscount: membershipPurchasesWithDiscount,
        purchasesTotal: membershipTxns.length,
      },
    },
    consultations: {
      freeQuota: {
        count:                freeSessions.length,
        countThisMonth:       freeSessionsThisMonth.length,
        estimatedValue:       freeSessionValue,
        estimatedValueThisMonth: freeSessionValueThisMonth,
        byMentor,
      },
      paid: {
        count:   paidSessions.length,
        revenue: paidSessionRevenue,
      },
    },
    networkPass: {
      totalCheckIns:      checkedInVisits.length,
      checkInsThisMonth:  visitsThisMonth.length,
      creditsIssuedThisMonth:   totalCreditsIssuedThisMonth,
      creditsUsedThisMonth,
      utilizationRatePct: utilizationRate,
      topSpaces: bySpace,
    },
    spaceBookings: {
      membershipDiscountEstimate: membershipSpaceDiscountEstimate,
    },
    totals: {
      totalValueGiven: freeSessionValue + membershipSpaceDiscountEstimate + membershipDiscountTotal,
      membershipRevenue,
      netBalance: membershipRevenue - freeSessionValue - membershipSpaceDiscountEstimate - membershipDiscountTotal,
    },
    monthlyTrend: Object.entries(monthlyTrend)
      .filter(([k]) => k <= thisMonth)
      .map(([month, values]) => ({ month, ...values })),
  };
}
