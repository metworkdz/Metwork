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
  // Network Pass is an entrepreneur benefit; freelancer Premium grants none.
  if (!planCode || planCode === 'FREELANCER_PREMIUM') return 0;
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

/** Meta flag marking the one-time 2026-08 Startup repricing as applied. */
const STARTUP_REPRICE_FLAG = 'membershipStartupRepricedAt';

/**
 * The 2026-08 Startup terms, applied ONCE to an already-seeded plan config.
 *
 * Seeding is additive by design — a stored plan record is never overwritten —
 * which means a change to `DEFAULT_PLAN_BENEFITS` reaches a fresh database but
 * NOT a deployment that has already run the admin Commissions page. This is the
 * one-time bridge for that gap. Only the two fields that actually changed are
 * written: an admin's edits to the annual discount, the space rate or the
 * Recommended tag are preserved.
 */
const STARTUP_REPRICE = {
  monthlyPrice:             3_500,
  consultationDiscountRate: 0.20,
} as const;

/**
 * Seed plan configs on first admin load, additively — a plan code that is
 * already stored is never touched. Runs three one-time, non-destructive steps:
 *
 *  1. Append any missing plan config from DEFAULT_MEMBERSHIP_PLAN_CONFIGS.
 *  2. Normalize the Network Pass allowances to the new defaults (Entrepreneur
 *     0, Startup 5) — but ONLY when an admin has never edited them
 *     (`creditConfigUpdatedAt` unset). An admin's explicit value always wins.
 *  3. Backfill the frozen snapshot of every ACTIVE membership that predates
 *     snapshotting, using the terms that were live when it was bought
 *     (15 %/3 passes and 20 %/10 passes respectively). Without this, existing
 *     members would silently inherit the new terms on their next booking —
 *     the opposite of grandfathering.
 *  4. Apply the one-time 2026-08 Startup repricing to an already-stored STARTUP
 *     config (see STARTUP_REPRICE). Step 1 cannot do this: it only appends.
 *
 * Idempotent: steps 1 and 2 are conditional, steps 3 and 4 are guarded by meta
 * flags (step 3 additionally by a per-record "has no snapshot" check).
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
  const needsStartupReprice = !data.meta?.[STARTUP_REPRICE_FLAG];

  if (
    !missingConfig &&
    !needsCreditNormalization &&
    !needsLegacyBackfill &&
    !needsStartupReprice
  ) {
    return planConfigsFrom(data);
  }

  return db.update((store) => {
    // ── 1. Append missing plan configs (never modify existing ones) ────────
    if (!Array.isArray(store.membershipPlanConfigs)) store.membershipPlanConfigs = [];
    const appendedNow = new Set<string>();
    for (const def of DEFAULT_MEMBERSHIP_PLAN_CONFIGS) {
      if (!store.membershipPlanConfigs.some((c) => c.planCode === def.planCode)) {
        store.membershipPlanConfigs.push({ ...def });
        appendedNow.add(def.planCode);
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
        // Freelancer Premium postdates snapshotting — none can be pre-snapshot.
        if (!planCode || planCode === 'FREELANCER_PREMIUM') continue;
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

    // ── 4. One-time Startup repricing on an already-stored config ─────────
    // Ordered AFTER the snapshot backfill on purpose: step 3 must capture the
    // terms a grandfathered member bought, which are the pre-repricing ones.
    if (!store.meta[STARTUP_REPRICE_FLAG]) {
      const stored = store.membershipPlanConfigs.find((c) => c.planCode === 'STARTUP');
      // Never on a record step 1 just appended (it already carries the current
      // shipped terms) nor once Metwork 2.0 terms are in — either way the
      // 2026-08 terms would be a step backwards.
      if (stored && !appendedNow.has('STARTUP') && !store.meta[METWORK2_TERMS_FLAG]) {
        stored.monthlyPrice             = STARTUP_REPRICE.monthlyPrice;
        stored.consultationDiscountRate = STARTUP_REPRICE.consultationDiscountRate;
        stored.updatedAt                = new Date().toISOString();
      }
      // Flag set either way: on a fresh database step 1 just appended the
      // record at the new terms, so there is nothing left to reprice.
      store.meta[STARTUP_REPRICE_FLAG] = new Date().toISOString();
    }

    return planConfigsFrom(store);
  });
}

// ---------------------------------------------------------------------------
// Metwork 2.0 plan terms — one-time, explicitly triggered
// ---------------------------------------------------------------------------

/** Meta flag marking the Metwork 2.0 terms as applied. */
const METWORK2_TERMS_FLAG = 'membershipMetwork2TermsAt';

/**
 * The fields Metwork 2.0 changes on an already-stored config. Anything else an
 * admin edited (pass counts, semester length) is left alone.
 *
 *   Founder (STARTUP)  1 900 /mo, 20 % off annually, 10 % consultations, 10 % spaces
 *   Entrepreneur       no longer recommended (and no longer sold — see
 *                      PURCHASABLE_PLANS; the config stays so its members resolve)
 *
 * FREELANCER_PREMIUM needs nothing here: step 1 of `ensureMembershipPlanConfigs`
 * appends it at its shipped defaults, and `planConfigsFrom` falls back to those
 * defaults until then.
 */
export const METWORK2_PLAN_TERMS = {
  STARTUP: {
    monthlyPrice:             1_900,
    annualDiscountPercent:    20,
    consultationDiscountRate: 0.10,
    spaceDiscountRate:        0.10,
    recommended:              true,
  },
  ENTREPRENEUR: { recommended: false },
} as const;

/** What `applyMetwork2PlanTerms` did (or would do, on a dry run). */
export interface Metwork2TermsReport {
  alreadyApplied: boolean;
  /** Active memberships that had no frozen rates and were frozen at their current terms. */
  frozenMembershipIds: string[];
  /** Paid users with no membership record and no mirror, given a mirror of their current terms. */
  mirroredUserIds: string[];
  startupBefore: Pick<MembershipPlanConfigRecord, 'monthlyPrice' | 'annualDiscountPercent' | 'consultationDiscountRate' | 'spaceDiscountRate'> | null;
}

/** Minimal draft slice `applyMetwork2PlanTerms` mutates. */
type Metwork2Draft = {
  membershipPlanConfigs?: MembershipPlanConfigRecord[];
  userMemberships?: UserMembershipRecordLike[];
  users: Array<{
    id: string;
    membershipCode: string | null;
    membershipTier?: string | null;
    membershipExpiresAt?: string | null;
    membershipSpaceDiscountRate?: number;
    membershipConsultationDiscountRate?: number;
  }>;
  meta?: { platformConfig?: PlatformConfig; [METWORK2_TERMS_FLAG]?: string } & Record<string, unknown>;
};
type UserMembershipRecordLike = {
  id: string;
  userId: string;
  plan: string;
  status: string;
  spaceDiscountRate?: number;
  consultationDiscountRate?: number;
  monthlyPassCount?: number;
  snapshotAt?: string;
};

/**
 * Apply the Metwork 2.0 terms to a store draft. Pure over its argument, so the
 * script can run it against a clone for a dry run and against the real draft
 * inside `db.update` with `--confirm`.
 *
 * Grandfathering comes FIRST: every active member who would otherwise read the
 * live config is frozen at the terms they have today, then the config moves.
 * A Startup member who paid 3 500 for 20 % consultations keeps 20 % until
 * their period ends; they renew as Founder at the new terms.
 *
 * Deliberately not run from `ensureMembershipPlanConfigs` (an admin page
 * visit): a live price change ships only when someone runs the script.
 * Idempotent through the meta flag.
 */
export function applyMetwork2PlanTerms(store: Metwork2Draft, now = new Date()): Metwork2TermsReport {
  const startup = (store.membershipPlanConfigs ?? []).find((c) => c.planCode === 'STARTUP') ?? null;
  const report: Metwork2TermsReport = {
    alreadyApplied: Boolean(store.meta?.[METWORK2_TERMS_FLAG]),
    frozenMembershipIds: [],
    mirroredUserIds: [],
    startupBefore: startup
      ? {
          monthlyPrice:             startup.monthlyPrice,
          annualDiscountPercent:    startup.annualDiscountPercent,
          consultationDiscountRate: startup.consultationDiscountRate,
          spaceDiscountRate:        startup.spaceDiscountRate,
        }
      : null,
  };
  if (report.alreadyApplied) return report;

  const nowIso = now.toISOString();
  const configs = planConfigsFrom(store);
  const configFor = (code: PaidPlanCode) => configs.find((c) => c.planCode === code)!;

  // ── 1. Freeze every active membership still reading live config ─────────
  const memberships = store.userMemberships ?? [];
  for (const m of memberships) {
    if (m.status !== 'ACTIVE' || m.spaceDiscountRate !== undefined) continue;
    const planCode = normalizePlanCode(m.plan);
    if (!planCode) continue;
    const current = configFor(planCode);
    m.spaceDiscountRate        = current.spaceDiscountRate;
    m.consultationDiscountRate = current.consultationDiscountRate;
    m.monthlyPassCount         = passCountFrom(store, planCode);
    m.snapshotAt               = nowIso;
    report.frozenMembershipIds.push(m.id);
  }

  // ── 2. Mirror paid users that have neither a snapshot nor a mirror ──────
  for (const u of store.users) {
    if (u.membershipExpiresAt && new Date(u.membershipExpiresAt) <= now) continue;
    const planCode = normalizePlanCode(u.membershipCode) ?? normalizePlanCode(u.membershipTier);
    if (!planCode) continue;
    if (typeof u.membershipSpaceDiscountRate === 'number') continue;
    const hasSnapshot = memberships.some(
      (m) =>
        m.userId === u.id &&
        m.status === 'ACTIVE' &&
        normalizePlanCode(m.plan) === planCode &&
        m.spaceDiscountRate !== undefined,
    );
    if (hasSnapshot) continue;
    const current = configFor(planCode);
    u.membershipSpaceDiscountRate        = current.spaceDiscountRate;
    u.membershipConsultationDiscountRate = current.consultationDiscountRate;
    report.mirroredUserIds.push(u.id);
  }

  // ── 3. Move the stored configs to the new terms ─────────────────────────
  if (!Array.isArray(store.membershipPlanConfigs)) store.membershipPlanConfigs = [];
  for (const def of DEFAULT_MEMBERSHIP_PLAN_CONFIGS) {
    if (!store.membershipPlanConfigs.some((c) => c.planCode === def.planCode)) {
      store.membershipPlanConfigs.push({ ...def });
    }
  }
  for (const c of store.membershipPlanConfigs) {
    if (c.planCode === 'STARTUP') Object.assign(c, METWORK2_PLAN_TERMS.STARTUP, { updatedAt: nowIso });
    if (c.planCode === 'ENTREPRENEUR') Object.assign(c, METWORK2_PLAN_TERMS.ENTREPRENEUR, { updatedAt: nowIso });
  }

  if (!store.meta) store.meta = {};
  store.meta[METWORK2_TERMS_FLAG] = nowIso;
  return report;
}
