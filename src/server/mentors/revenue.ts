/**
 * Consultation revenue & subsidy summary for the admin dashboard.
 *
 * Sourced from the AUTHORITATIVE mentor ledger (the COMMISSION audit rows written
 * at settlement), never recomputed from a booking's discounted amount. Each row
 * froze the full split: collected, base price, consultant share, signed platform
 * share, and the tier/promo discounts the platform absorbed.
 *
 * Under the owner-locked subsidize model the platform absorbs every discount, so
 * `netPlatformRevenue = grossCommission − totalDiscountSubsidy` and can be
 * negative. The admin can read the promo subsidy as a deductible expense.
 *
 * Cancelled bookings are excluded (their consultant credit was reversed).
 */
import { db } from '@/server/db/store';

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface ConsultationRevenuePerMentor {
  mentorId: string;
  mentorName: string;
  /** Settled consultations counted. */
  count: number;
  /** What users actually paid (after discounts). */
  collected: number;
  /** Paid to the consultant (on the full base price). */
  consultantEarnings: number;
  /** Platform commission before discounts (basePrice × platformRate). */
  grossCommission: number;
  /** Discount the platform absorbed from promo codes. */
  promoSubsidy: number;
  /** Discount the platform absorbed from membership tiers. */
  tierSubsidy: number;
  /** Net platform revenue (signed): grossCommission − promoSubsidy − tierSubsidy. */
  netPlatform: number;
}

export interface ConsultationRevenueSummary {
  settledCount: number;
  totalCollected: number;
  totalConsultantEarnings: number;
  grossCommission: number;
  promoSubsidy: number;
  tierSubsidy: number;
  totalDiscountSubsidy: number;
  /** Net platform revenue (signed) = grossCommission − totalDiscountSubsidy. */
  netPlatformRevenue: number;
  perMentor: ConsultationRevenuePerMentor[];
}

export async function getConsultationRevenueSummary(): Promise<ConsultationRevenueSummary> {
  const data = await db.read();

  const cancelled = new Set(
    (data.mentorBookings ?? []).filter((b) => b.status === 'CANCELLED').map((b) => b.id),
  );
  const mentorName = new Map((data.mentors ?? []).map((m) => [m.id, m.fullName]));

  const summary: ConsultationRevenueSummary = {
    settledCount: 0,
    totalCollected: 0,
    totalConsultantEarnings: 0,
    grossCommission: 0,
    promoSubsidy: 0,
    tierSubsidy: 0,
    totalDiscountSubsidy: 0,
    netPlatformRevenue: 0,
    perMentor: [],
  };
  const perMentor = new Map<string, ConsultationRevenuePerMentor>();

  for (const t of data.mentorLedgerTxns ?? []) {
    if (t.type !== 'COMMISSION') continue;
    if (!t.bookingId || cancelled.has(t.bookingId)) continue;

    const md = t.metadata ?? {};
    const collected = num(md.gross);
    const basePrice = num(md.basePrice);
    const consultantShare = num(md.consultantShare);
    const platformShare = num(md.platformShare);
    const promo = num(md.promoDiscountAmount);
    const tier = num(md.tierDiscountAmount);
    const grossCommission = Math.round(basePrice * num(md.platformRate));

    summary.settledCount += 1;
    summary.totalCollected += collected;
    summary.totalConsultantEarnings += consultantShare;
    summary.grossCommission += grossCommission;
    summary.promoSubsidy += promo;
    summary.tierSubsidy += tier;
    summary.netPlatformRevenue += platformShare;

    const agg =
      perMentor.get(t.mentorId) ??
      {
        mentorId: t.mentorId,
        mentorName: mentorName.get(t.mentorId) ?? 'Unknown',
        count: 0,
        collected: 0,
        consultantEarnings: 0,
        grossCommission: 0,
        promoSubsidy: 0,
        tierSubsidy: 0,
        netPlatform: 0,
      };
    agg.count += 1;
    agg.collected += collected;
    agg.consultantEarnings += consultantShare;
    agg.grossCommission += grossCommission;
    agg.promoSubsidy += promo;
    agg.tierSubsidy += tier;
    agg.netPlatform += platformShare;
    perMentor.set(t.mentorId, agg);
  }

  summary.totalDiscountSubsidy = summary.promoSubsidy + summary.tierSubsidy;
  summary.perMentor = [...perMentor.values()].sort((a, b) => b.count - a.count);
  return summary;
}
