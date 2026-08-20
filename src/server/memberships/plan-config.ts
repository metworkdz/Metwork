/**
 * Membership plan configuration — the DB-backed replacement for the hardcoded
 * `MEMBERSHIP_PRICES` / `SPACE_DISCOUNT` / `CONSULTATION_DISCOUNT` constants.
 *
 * Seeding follows the commission-rules pattern exactly (see
 * `dashboard/admin/commissions/page.tsx`): missing plan codes are appended on
 * first admin load, existing records are NEVER modified.
 *
 * What this module governs:
 *   - price of a NEW purchase / renewal (via `@/lib/billing-cycles`)
 *   - discount rates granted to a NEW purchase
 *   - which plan carries the "Recommended" tag
 *
 * What it deliberately does NOT govern:
 *   - Network Pass allowances — canonical in `meta.platformConfig`, written
 *     only by `setAdminCreditConfig` (one writer per value)
 *   - benefits of an ALREADY-ACTIVE membership — those come from the frozen
 *     snapshot on the UserMembershipRecord (see `resolveMemberBenefits`)
 */
import {
  db,
  defaultPlatformConfig,
  LEGACY_MONTHLY_PASS_COUNTS,
  type MembershipPlanConfigRecord,
  type PlatformConfig,
} from '@/server/db/store';
import {
  DEFAULT_MEMBERSHIP_PLAN_CONFIGS,
  LEGACY_PLAN_DISCOUNT_RATES,
} from '@/server/admin/settings-defaults';
import { computeCyclePrices, type CyclePrices } from '@/lib/billing-cycles';
import {
  PAID_PLAN_CODES,
  normalizePlanCode,
  type PaidPlanCode,
} from '@/lib/membership-benefits';

// The store's document type is intentionally not exported, so the read helpers
// below take the minimal structural slice they actually need. That also lets
// them run against a draft inside `db.update()`.
/** Minimal doc slice needed to resolve plan configs. */
type PlanConfigSource = { membershipPlanConfigs?: MembershipPlanConfigRecord[] };
/** Minimal doc slice needed to resolve pass allowances. */
type PassCountSource = { meta?: { platformConfig?: PlatformConfig } };

// Plan codes and the code normalizer are defined in the client-safe benefits
// module and re-exported here so server callers keep one import surface.
export { PAID_PLAN_CODES, normalizePlanCode, type PaidPlanCode };

/** The in-code default for a plan — last-resort fallback when nothing is stored. */
export function defaultPlanConfig(planCode: PaidPlanCode): MembershipPlanConfigRecord {
  const found = DEFAULT_MEMBERSHIP_PLAN_CONFIGS.find((p) => p.planCode === planCode);
  // DEFAULT_MEMBERSHIP_PLAN_CONFIGS covers every PaidPlanCode; the throw is a
  // type-narrowing guard, not an expected runtime path.
  if (!found) throw new Error(`defaultPlanConfig: no default for plan ${planCode}`);
  return found;
}

/**
 * Read the stored plan configs, WITHOUT seeding (safe on hot request paths).
 * Falls back to the in-code default for any plan not yet persisted.
 */
export async function getMembershipPlanConfigs(): Promise<MembershipPlanConfigRecord[]> {
  const data = await db.read();
  return planConfigsFrom(data);
}

/** Same resolution as `getMembershipPlanConfigs`, against an already-read doc. */
export function planConfigsFrom(data: PlanConfigSource): MembershipPlanConfigRecord[] {
  const stored = data.membershipPlanConfigs ?? [];
  return PAID_PLAN_CODES.map(
    (code) => stored.find((c: MembershipPlanConfigRecord) => c.planCode === code) ?? defaultPlanConfig(code),
  );
}

/** Resolve one plan's config. Returns null for FREE / unknown codes. */
export async function getPlanConfig(
  codeOrTier: string | null | undefined,
): Promise<MembershipPlanConfigRecord | null> {
  const planCode = normalizePlanCode(codeOrTier);
  if (!planCode) return null;
  const configs = await getMembershipPlanConfigs();
  return configs.find((c) => c.planCode === planCode) ?? defaultPlanConfig(planCode);
}

/** Cycle prices for one plan, derived from its config. Null for FREE / unknown. */
export function pricesForConfig(config: MembershipPlanConfigRecord): CyclePrices {
  return computeCyclePrices({
    monthlyPrice:          config.monthlyPrice,
    semesterlyMonths:      config.semesterlyMonths,
    annualDiscountPercent: config.annualDiscountPercent,
  });
}

/** Convenience: cycle prices for a plan code. Null for FREE / unknown codes. */
export async function getPlanPrices(
  codeOrTier: string | null | undefined,
): Promise<CyclePrices | null> {
  const config = await getPlanConfig(codeOrTier);
  return config ? pricesForConfig(config) : null;
}

/**
 * Monthly Network Pass allowance for a plan, read from the canonical
 * platform-config home (NOT from the plan config record).
 */
export function passCountFrom(
  data: PassCountSource,
  codeOrTier: string | null | undefined,
): number {
  const planCode = normalizePlanCode(codeOrTier);
  if (!planCode) return 0;
  const cfg = data.meta?.platformConfig;
  const value =
    planCode === 'STARTUP'
      ? cfg?.founderMonthlyCredits ?? defaultPlatformConfig.founderMonthlyCredits
      : cfg?.builderMonthlyCredits ?? defaultPlatformConfig.builderMonthlyCredits;
  return Math.max(0, value ?? 0);
}

/** Async form of `passCountFrom`. */
export async function getPlanPassCount(codeOrTier: string | null | undefined): Promise<number> {
  const data = await db.read();
  return passCountFrom(data, codeOrTier);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** Meta flag marking the one-time legacy-terms snapshot backfill as done. */
const LEGACY_BACKFILL_FLAG = 'membershipLegacyTermsBackfilledAt';

/**
 * Seed plan configs on first admin load, additively — a plan code that is
 * already stored is never touched. Runs three one-time, non-destructive steps:
 *
 *  1. Append any missing plan config from DEFAULT_MEMBERSHIP_PLAN_CONFIGS.
 *  2. Normalize the Network Pass allowances to the new defaults (Builder 0,
 *     Founder 5) — but ONLY when an admin has never edited them
 *     (`creditConfigUpdatedAt` unset). An admin's explicit value always wins.
 *  3. Backfill the frozen snapshot of every ACTIVE membership that predates
 *     snapshotting, using the terms that were live when it was bought
 *     (Builder 15 %/3 passes, Founder 20 %/10 passes). Without this, existing
 *     members would silently inherit the new terms on their next booking —
 *     the opposite of grandfathering.
 *
 * Idempotent: steps 1 and 2 are conditional, step 3 is guarded by a meta flag
 * AND by a per-record "has no snapshot" check.
 */
export async function ensureMembershipPlanConfigs(): Promise<MembershipPlanConfigRecord[]> {
  const data = await db.read();

  const missingConfig = PAID_PLAN_CODES.some(
    (code) => !(data.membershipPlanConfigs ?? []).some((c) => c.planCode === code),
  );
  const pcRead = data.meta?.platformConfig;
  const needsCreditNormalization =
    pcRead !== undefined &&
    !pcRead.creditConfigUpdatedAt &&
    (pcRead.builderMonthlyCredits !== defaultPlatformConfig.builderMonthlyCredits ||
      pcRead.founderMonthlyCredits !== defaultPlatformConfig.founderMonthlyCredits);
  const needsLegacyBackfill = !data.meta?.[LEGACY_BACKFILL_FLAG];

  if (!missingConfig && !needsCreditNormalization && !needsLegacyBackfill) {
    return planConfigsFrom(data);
  }

  return db.update((store) => {
    // ── 1. Append missing plan configs (never modify existing ones) ────────
    if (!Array.isArray(store.membershipPlanConfigs)) store.membershipPlanConfigs = [];
    for (const def of DEFAULT_MEMBERSHIP_PLAN_CONFIGS) {
      if (!store.membershipPlanConfigs.some((c) => c.planCode === def.planCode)) {
        store.membershipPlanConfigs.push({ ...def });
      }
    }

    // ── 2. Normalize pass allowances, unless an admin set them explicitly ──
    if (!store.meta) store.meta = {};
    const pc = store.meta.platformConfig;
    if (pc && !pc.creditConfigUpdatedAt) {
      pc.builderMonthlyCredits = defaultPlatformConfig.builderMonthlyCredits;
      pc.founderMonthlyCredits = defaultPlatformConfig.founderMonthlyCredits;
    }

    // ── 3. Backfill legacy terms onto pre-snapshot ACTIVE memberships ──────
    if (!store.meta[LEGACY_BACKFILL_FLAG]) {
      const now = new Date().toISOString();
      for (const m of store.userMemberships ?? []) {
        if (m.status !== 'ACTIVE') continue;
        // Already snapshotted (bought after this release) — leave untouched.
        if (m.spaceDiscountRate !== undefined) continue;
        const planCode = normalizePlanCode(m.plan);
        if (!planCode) continue;
        const legacy = LEGACY_PLAN_DISCOUNT_RATES[planCode];
        m.spaceDiscountRate        = legacy.spaceDiscountRate;
        m.consultationDiscountRate = legacy.consultationDiscountRate;
        m.monthlyPassCount         = LEGACY_MONTHLY_PASS_COUNTS[planCode];
        m.snapshotAt               = now;
        // Deliberately NOT setting basePrice/amountCharged: what these members
        // actually paid is not recoverable from the record, and inventing a
        // number would corrupt the audit trail. Absent means unknown.
      }
      store.meta[LEGACY_BACKFILL_FLAG] = now;
    }

    return planConfigsFrom(store);
  });
}
