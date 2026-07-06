/**
 * Mentor (consultant) consultation commission resolver.
 *
 * Centralizes the `MENTOR_CONSULTATION` rate lookup that was previously inlined
 * in the admin mentor-revenue report, so settlement, previews, and reports all
 * read the same number. The rate is admin-configurable via `commissionRules`;
 * when no active rule exists we fall back to the seeded default (30 % platform /
 * 70 % mentor).
 *
 * Pure function — pass the rules array in; no DB, no client input. Every split
 * is integer DZD.
 */
import type { CommissionRuleRecord } from '@/server/db/store';
import { DEFAULT_COMMISSION_RULES } from '@/server/admin/settings-defaults';

export const MENTOR_CONSULTATION_RULE_TYPE = 'MENTOR_CONSULTATION';
/** Rule type for SELF-signed-up consultants (consultant portal signups). */
export const MENTOR_CONSULTATION_SELF_RULE_TYPE = 'MENTOR_CONSULTATION_SELF';

/** Default platform cut when no admin rule is configured (mentor keeps the rest). */
export const DEFAULT_MENTOR_PLATFORM_RATE =
  DEFAULT_COMMISSION_RULES.find((r) => r.transactionType === MENTOR_CONSULTATION_RULE_TYPE)?.rate ??
  0.3;

/** Default platform cut for self-signed-up consultants (20 % / they keep 80 %). */
export const DEFAULT_SELF_CONSULTANT_PLATFORM_RATE =
  DEFAULT_COMMISSION_RULES.find(
    (r) => r.transactionType === MENTOR_CONSULTATION_SELF_RULE_TYPE,
  )?.rate ?? 0.2;

/**
 * Which mentor a rate is being resolved for. `source` comes from
 * `MentorRecord.source`: 'SELF' = portal self-signup (20 % default rule),
 * anything else (including absent, i.e. every legacy admin-added mentor) uses
 * the standard MENTOR_CONSULTATION rule — existing splits are untouched.
 */
export interface MentorCommissionContext {
  source?: 'ADMIN' | 'SELF' | null;
}

export interface MentorCommissionRates {
  /** Platform cut as a decimal 0–1. */
  platformRate: number;
  /** Mentor share as a decimal 0–1 (= 1 − platformRate). */
  mentorRate: number;
}

/** Clamp a configured rate into [0,1]; fall back to the given default when absent/invalid. */
function resolveRate(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Resolve the effective platform / mentor split for consultations. Prefers the
 * active admin-configured rule for the mentor's tier; otherwise the seeded
 * default. Mirrors the lookup used by the mentor-revenue report.
 *
 * Self-signed-up consultants (`context.source === 'SELF'`) resolve against the
 * `MENTOR_CONSULTATION_SELF` rule (default 20 %); everyone else — including all
 * legacy mentors with no `source` field — keeps `MENTOR_CONSULTATION` (30 %).
 */
export function resolveMentorCommissionRates(
  rules?: readonly CommissionRuleRecord[] | null,
  context?: MentorCommissionContext | null,
): MentorCommissionRates {
  const ruleType =
    context?.source === 'SELF' ? MENTOR_CONSULTATION_SELF_RULE_TYPE : MENTOR_CONSULTATION_RULE_TYPE;
  const fallback =
    context?.source === 'SELF' ? DEFAULT_SELF_CONSULTANT_PLATFORM_RATE : DEFAULT_MENTOR_PLATFORM_RATE;
  const active = (rules ?? []).find((r) => r.transactionType === ruleType && r.isActive);
  const platformRate = resolveRate(active?.rate, fallback);
  return { platformRate, mentorRate: 1 - platformRate };
}

export interface MentorEarningSplit {
  /** The full consultation amount that flowed through the platform. Integer DZD. */
  gross: number;
  /** Platform commission taken from the gross. Integer DZD. */
  platformCommission: number;
  /** Net credited to the mentor (gross − commission). Integer DZD. */
  mentorNet: number;
  platformRate: number;
  mentorRate: number;
}

/**
 * Split a gross consultation amount into the mentor's net and the platform's
 * commission. Commission is rounded; net is the remainder so the two always sum
 * back to `gross` exactly (no rounding drift, never negative).
 */
export function computeMentorEarningSplit(
  gross: number,
  rules?: readonly CommissionRuleRecord[] | null,
  context?: MentorCommissionContext | null,
): MentorEarningSplit {
  const base = Number.isFinite(gross) && gross > 0 ? Math.round(gross) : 0;
  const { platformRate, mentorRate } = resolveMentorCommissionRates(rules, context);
  const platformCommission = Math.round(base * platformRate);
  const mentorNet = Math.max(0, base - platformCommission);
  return { gross: base, platformCommission, mentorNet, platformRate, mentorRate };
}

export interface MentorPromoSplit {
  /** Absolute base price B the consultant share is computed on (before tier+promo). */
  basePrice: number;
  /** What the user actually paid (after tier + promo). Integer DZD. */
  collectedAmount: number;
  /** Net credited to the mentor = round(basePrice × mentorRate). Never negative. */
  consultantShare: number;
  /**
   * Platform's net on this consultation = collectedAmount − consultantShare.
   * SIGNED: negative means the platform subsidised the consultant out of pocket
   * (the locked "subsidize, no cap" model — discounts are the platform's expense).
   */
  platformShare: number;
  platformRate: number;
  mentorRate: number;
}

/**
 * Promo/subsidy-aware split (P3, owner-locked 2026-06-18).
 *
 * The consultant is ALWAYS paid `round(basePrice × mentorRate)` on the FULL,
 * undiscounted price — every tier/promo discount is absorbed by the PLATFORM.
 * The platform's share is therefore whatever is left of what the user actually
 * paid, and MAY be negative (platform pays the consultant from its own funds).
 * No cap, no rejection — the gap is an expense the admin dashboard reports.
 *
 * Pure: pass the rules in. `basePrice`/`collectedAmount` are integer DZD.
 */
export function computeMentorPromoSplit(
  input: { basePrice: number; collectedAmount: number },
  rules?: readonly CommissionRuleRecord[] | null,
  context?: MentorCommissionContext | null,
): MentorPromoSplit {
  const basePrice =
    Number.isFinite(input.basePrice) && input.basePrice > 0 ? Math.round(input.basePrice) : 0;
  const collectedAmount =
    Number.isFinite(input.collectedAmount) && input.collectedAmount > 0
      ? Math.round(input.collectedAmount)
      : 0;
  const { platformRate, mentorRate } = resolveMentorCommissionRates(rules, context);
  const consultantShare = Math.max(0, Math.round(basePrice * mentorRate));
  const platformShare = collectedAmount - consultantShare;
  return { basePrice, collectedAmount, consultantShare, platformShare, platformRate, mentorRate };
}
