/**
 * Mentor (consultant) commission resolver.
 *
 * Centralizes the rate lookup so settlement, previews, and reports all read the
 * same number. Two rules, keyed by what the consultant is being paid FOR:
 *   - `MENTOR_CONSULTATION` — 1:1 sessions (default 20 % platform / 80 % them)
 *   - `MENTOR_PROGRAM`      — consultant-owned programs (default 5 % / 95 %)
 * Both are admin-configurable via `commissionRules`; the seeded defaults are
 * only the fallback when no active rule row exists.
 *
 * History: a separate `MENTOR_CONSULTATION_SELF` tier (20 %) once gave portal
 * self-signups a better rate than admin-added mentors (30 %). That split was
 * retired when the standard consultation rate itself became 20 % — one rate now
 * applies to every consultant, so `source` no longer affects the split.
 * Historical earnings are unaffected: `creditPendingEarning` freezes the
 * resolved rates into each ledger txn at credit time.
 *
 * Pure function — pass the rules array in; no DB, no client input. Every split
 * is integer DZD.
 */
import type { CommissionRuleRecord } from '@/server/db/store';
import { DEFAULT_COMMISSION_RULES } from '@/server/admin/settings-defaults';

export const MENTOR_CONSULTATION_RULE_TYPE = 'MENTOR_CONSULTATION';
/** Rule type for paid consultant-OWNED programs (trainings/workshops/webinars). */
export const MENTOR_PROGRAM_RULE_TYPE = 'MENTOR_PROGRAM';

/** Default platform cut on consultations when no admin rule is configured. */
export const DEFAULT_MENTOR_PLATFORM_RATE =
  DEFAULT_COMMISSION_RULES.find((r) => r.transactionType === MENTOR_CONSULTATION_RULE_TYPE)?.rate ??
  0.2;

/** Default platform cut on consultant-owned programs (5 % / they keep 95 %). */
export const DEFAULT_MENTOR_PROGRAM_PLATFORM_RATE =
  DEFAULT_COMMISSION_RULES.find((r) => r.transactionType === MENTOR_PROGRAM_RULE_TYPE)?.rate ?? 0.05;

/** What the consultant is being paid for. Absent ⇒ CONSULTATION (back-compat). */
export type MentorEarningKind = 'CONSULTATION' | 'PROGRAM';

/**
 * Which rate is being resolved. `kind` selects the rule; every existing caller
 * omits it and therefore keeps resolving the consultation rate exactly as before.
 */
export interface MentorCommissionContext {
  kind?: MentorEarningKind | null;
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
 * Resolve the effective platform / consultant split. Prefers the active
 * admin-configured rule for the given `kind`; otherwise the seeded default.
 * Mirrors the lookup used by the mentor-revenue report.
 *
 * `kind: 'PROGRAM'` resolves `MENTOR_PROGRAM` (default 5 %); everything else —
 * including a null/absent context, i.e. every pre-existing caller — resolves
 * `MENTOR_CONSULTATION` (default 20 %).
 */
export function resolveMentorCommissionRates(
  rules?: readonly CommissionRuleRecord[] | null,
  context?: MentorCommissionContext | null,
): MentorCommissionRates {
  const isProgram = context?.kind === 'PROGRAM';
  const ruleType = isProgram ? MENTOR_PROGRAM_RULE_TYPE : MENTOR_CONSULTATION_RULE_TYPE;
  const fallback = isProgram
    ? DEFAULT_MENTOR_PROGRAM_PLATFORM_RATE
    : DEFAULT_MENTOR_PLATFORM_RATE;
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
