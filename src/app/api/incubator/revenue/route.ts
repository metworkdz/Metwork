/**
 * GET /api/incubator/revenue
 *
 * Returns revenue summary and monthly breakdown for all bookings on the
 * incubator's spaces, programs, and events.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db, defaultPlatformConfig } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { resolveCommissionRates } from '@/server/payments/commission';
import { getEffectiveSubscriptionCode } from '@/server/incubator/service';
import { bookingCountsAsRevenue } from '@/server/bookings/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toYearMonth(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  // Effective plan applies read-time expiry: an expired/lapsed Pro plan reverts
  // to commission automatically, so commission resumes without a sweep.
  const subCode = getEffectiveSubscriptionCode(incubator);
  // Receiver-side rate from the central engine (FLAT ⇒ 0). Used only as a
  // fallback estimate for bookings that have no frozen commission yet.
  const cfg = { ...defaultPlatformConfig, ...data.meta?.platformConfig };
  const { receiverRate: commissionRate } = resolveCommissionRates(subCode, cfg);

  const ownedSpaceIds = new Set(
    (data.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );
  const ownedEventIds = new Set(
    (data.events ?? []).filter((e) => e.incubatorId === incubator.id).map((e) => e.id),
  );

  // Only settled/paid bookings count toward revenue. Awaiting-payment
  // (PENDING_PAYMENT) intents hold no seat and no money — excluded via the
  // shared rule so gross/net here can never drift from seat-hold / analytics.
  const relevant = data.bookings.filter(
    (b) =>
      bookingCountsAsRevenue(b) &&
      (
        (b.itemKind === 'SPACE'   && ownedSpaceIds.has(b.itemId))   ||
        (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId)) ||
        (b.itemKind === 'EVENT'   && ownedEventIds.has(b.itemId))
      ),
  );

  // Monthly buckets. Commission prefers the amount FROZEN on the booking at
  // settlement (the real ledger figure); only un-settled bookings fall back to
  // the live receiver-rate estimate. This keeps the dashboard consistent with
  // what actually moved through the wallet under the central engine.
  const bucketsMap = new Map<string, { gross: number; commission: number; bookings: number }>();
  for (const b of relevant) {
    const ym = toYearMonth(b.createdAt);
    const cur = bucketsMap.get(ym) ?? { gross: 0, commission: 0, bookings: 0 };
    cur.gross += b.totalAmount;
    cur.commission += b.commissionAmount ?? Math.round(b.totalAmount * commissionRate);
    cur.bookings += 1;
    bucketsMap.set(ym, cur);
  }

  const buckets = Array.from(bucketsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { gross, commission, bookings }]) => {
      return { month, gross, commission, net: gross - commission, bookings };
    });

  const totals = buckets.reduce(
    (acc, b) => ({
      gross: acc.gross + b.gross,
      commission: acc.commission + b.commission,
      net: acc.net + b.net,
      bookings: acc.bookings + b.bookings,
    }),
    { gross: 0, commission: 0, net: 0, bookings: 0 },
  );

  // This-month stats
  const thisMonth = toYearMonth(new Date().toISOString());
  const mtd = buckets.find((b) => b.month === thisMonth) ?? {
    gross: 0, commission: 0, net: 0, bookings: 0,
  };

  return json({
    incubator: {
      id: incubator.id,
      name: incubator.name,
      subscriptionTier: subCode,
      commissionRate,
    },
    totals,
    mtd,
    buckets,
  });
}
