/**
 * GET /api/incubator/revenue
 *
 * Returns revenue summary and monthly breakdown for all bookings on the
 * incubator's spaces and programs.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { platformCommissions } from '@/config/memberships';

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

  const commissionRate =
    incubator.subscriptionTier === 'COMMISSION' ? platformCommissions.incubatorBooking : 0;

  const ownedSpaceIds = new Set(
    data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  const relevant = data.bookings.filter(
    (b) =>
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED' &&
      (
        (b.itemKind === 'SPACE' && ownedSpaceIds.has(b.itemId)) ||
        (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId))
      ),
  );

  // Monthly buckets
  const bucketsMap = new Map<string, { gross: number; bookings: number }>();
  for (const b of relevant) {
    const ym = toYearMonth(b.createdAt);
    const cur = bucketsMap.get(ym) ?? { gross: 0, bookings: 0 };
    cur.gross += b.totalAmount;
    cur.bookings += 1;
    bucketsMap.set(ym, cur);
  }

  const buckets = Array.from(bucketsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { gross, bookings }]) => {
      const commission = Math.round(gross * commissionRate);
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
      subscriptionTier: incubator.subscriptionTier,
      commissionRate,
    },
    totals,
    mtd,
    buckets,
  });
}
