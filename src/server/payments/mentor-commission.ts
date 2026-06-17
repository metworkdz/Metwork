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

/** Default platform cut when no admin rule is configured (mentor keeps the rest). */
export const DEFAULT_MENTOR_PLATFORM_RATE =
  DEFAULT_COMMISSION_RULES.find((r) => r.transactionType === MENTOR_CONSULTATION_RULE_TYPE)?.rate ??
  0.3;

export interface MentorCommissionRates {
  /** Platform cut as a decimal 0–1. */
  platformRate: number;
  /** Mentor share as a decimal 0–1 (= 1 − platformRate). */
  mentorRate: number;
}

/** Clamp a configured rate into [0,1]; fall back to the default when absent/invalid. */
function resolveRate(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_MENTOR_PLATFORM_RATE;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Resolve the effective platform / mentor split for consultations. Prefers the
 * active admin-configured `MENTOR_CONSULTATION` rule; otherwise the seeded
 * default. Mirrors the lookup used by the mentor-revenue report.
 */
export function resolveMentorCommissionRates(
  rules?: readonly CommissionRuleRecord[] | null,
): MentorCommissionRates {
  const active = (rules ?? []).find(
    (r) => r.transactionType === MENTOR_CONSULTATION_RULE_TYPE && r.isActive,
  );
  const platformRate = resolveRate(active?.rate);
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
): MentorEarningSplit {
  const base = Number.isFinite(gross) && gross > 0 ? Math.round(gross) : 0;
  const { platformRate, mentorRate } = resolveMentorCommissionRates(rules);
  const platformCommission = Math.round(base * platformRate);
  const mentorNet = Math.max(0, base - platformCommission);
  return { gross: base, platformCommission, mentorNet, platformRate, mentorRate };
}
