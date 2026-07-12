/**
 * Partner Perks service — the ONE canonical module for perk CRUD, claims,
 * and voucher verification. Both admin and user routes call into here; no
 * tier or claim logic is duplicated elsewhere.
 *
 * Tier gating delegates to getEffectiveMembershipCode() (the platform's
 * single membership-active/tier source of truth) and maps BOTH membership
 * vocabularies through the rank table below:
 *   FREE / (unset)      → 0
 *   ENTREPRENEUR/BUILDER → 1
 *   STARTUP/FOUNDER      → 2
 *
 * Claims run atomically inside a single db.update() (the same serialized
 * write-queue lock used by the password-change TOCTOU fix), so two
 * concurrent claims can never assign the same pool code or double-issue
 * vouchers.
 */
import { randomUUID, randomInt } from 'node:crypto';
import {
  db,
  type PerkRecord,
  type PerkMinTier,
  type PromoCodePoolEntryRecord,
  type VoucherRecord,
  type UserRecord,
} from '@/server/db/store';
import {
  getEffectiveMembershipCode,
  type MembershipUserLike,
} from '@/server/memberships/service';
import type { CreatePerkInput, PatchPerkInput } from './schemas';

/* ─────────────────────── Tier gating (single source) ─────────────────────── */

/**
 * Rank of every effective membership code getEffectiveMembershipCode() can
 * return. Old membershipCode values and new membershipTier values collapse
 * to the same rank (ENTREPRENEUR ≡ BUILDER, STARTUP ≡ FOUNDER).
 */
const TIER_RANK: Record<string, number> = {
  FREE: 0,
  EXPLORER: 0,
  ENTREPRENEUR: 1,
  BUILDER: 1,
  STARTUP: 2,
  FOUNDER: 2,
};

/** Normalized display tier for a given effective code. */
function normalizedTier(effectiveCode: string): 'FREE' | 'BUILDER' | 'FOUNDER' {
  const rank = TIER_RANK[effectiveCode] ?? 0;
  return rank >= 2 ? 'FOUNDER' : rank === 1 ? 'BUILDER' : 'FREE';
}

/**
 * True when the user's CURRENT effective membership (expiry included — see
 * getEffectiveMembershipCode) meets or exceeds `minTier`. This is the only
 * tier comparison in the perks feature.
 */
export function meetsMinTier(user: MembershipUserLike, minTier: PerkMinTier): boolean {
  const effective = getEffectiveMembershipCode(user);
  return (TIER_RANK[effective] ?? 0) >= (TIER_RANK[minTier] ?? Infinity);
}

/* ─────────────────────── Admin: perk CRUD ─────────────────────── */

export interface PerkWithCounts extends PerkRecord {
  /** CODE_POOL: pool entries still AVAILABLE. Null for VOUCHER perks. */
  stockAvailable: number | null;
  /** CODE_POOL: pool entries ASSIGNED. Null for VOUCHER perks. */
  codesAssigned: number | null;
  /** VOUCHER: live (non-superseded) vouchers issued. Null for CODE_POOL perks. */
  claimCount: number | null;
}

function withCounts(
  perk: PerkRecord,
  entries: PromoCodePoolEntryRecord[],
  vouchers: VoucherRecord[],
): PerkWithCounts {
  if (perk.fulfillmentType === 'CODE_POOL') {
    const pool = entries.filter((e) => e.perkId === perk.id);
    return {
      ...perk,
      stockAvailable: pool.filter((e) => e.status === 'AVAILABLE').length,
      codesAssigned: pool.filter((e) => e.status === 'ASSIGNED').length,
      claimCount: null,
    };
  }
  return {
    ...perk,
    stockAvailable: null,
    codesAssigned: null,
    claimCount: vouchers.filter((v) => v.perkId === perk.id && !v.superseded).length,
  };
}

/** List all perks (newest first) with computed stock / claim counts. */
export async function listPerks(): Promise<PerkWithCounts[]> {
  const data = await db.read();
  const entries = data.perkPoolEntries ?? [];
  const vouchers = data.perkVouchers ?? [];
  return [...(data.perks ?? [])]
    .reverse()
    .map((p) => withCounts(p, entries, vouchers));
}

/**
 * Create a perk. Throws 'THRESHOLD_NOT_APPLICABLE' when a lowStockThreshold
 * is supplied for a VOUCHER perk (thresholds only make sense for pools).
 */
export async function createPerk(input: CreatePerkInput): Promise<PerkRecord> {
  if (input.fulfillmentType === 'VOUCHER' && input.lowStockThreshold !== null) {
    throw new Error('THRESHOLD_NOT_APPLICABLE');
  }
  const now = new Date().toISOString();
  const record: PerkRecord = {
    id: randomUUID(),
    partnerName: input.partnerName.trim(),
    logoUrl: input.logoUrl,
    title: input.title.trim(),
    description: input.description.trim(),
    fulfillmentType: input.fulfillmentType,
    minTier: input.minTier,
    lowStockThreshold: input.lowStockThreshold,
    lowStockNotifiedAt: null,
    active: input.active,
    createdAt: now,
    updatedAt: now,
  };
  await db.update((d) => {
    if (!Array.isArray(d.perks)) d.perks = [];
    d.perks.push(record);
  });
  return record;
}

/**
 * Patch a perk. Returns null when not found. Throws
 * 'THRESHOLD_NOT_APPLICABLE' when setting a threshold on a VOUCHER perk.
 */
export async function updatePerk(
  id: string,
  input: PatchPerkInput,
): Promise<PerkRecord | null> {
  return db.update((d) => {
    const perk = (d.perks ?? []).find((p) => p.id === id);
    if (!perk) return null;
    if (
      perk.fulfillmentType === 'VOUCHER' &&
      input.lowStockThreshold !== undefined &&
      input.lowStockThreshold !== null
    ) {
      throw new Error('THRESHOLD_NOT_APPLICABLE');
    }
    if (input.partnerName !== undefined) perk.partnerName = input.partnerName.trim();
    if (input.logoUrl !== undefined) perk.logoUrl = input.logoUrl;
    if (input.title !== undefined) perk.title = input.title.trim();
    if (input.description !== undefined) perk.description = input.description.trim();
    if (input.minTier !== undefined) perk.minTier = input.minTier;
    if (input.lowStockThreshold !== undefined) perk.lowStockThreshold = input.lowStockThreshold;
    if (input.active !== undefined) perk.active = input.active;
    perk.updatedAt = new Date().toISOString();
    return { ...perk };
  });
}

/* ─────────────────────── Admin: code pool ─────────────────────── */

export interface AddCodesResult {
  added: number;
  /** Codes skipped because they already exist in this perk's pool (or repeat within the payload). */
  skippedDuplicates: number;
}

/**
 * Bulk-add newline-separated codes to a CODE_POOL perk. Dedupes against the
 * perk's existing pool AND within the payload itself. Clears
 * lowStockNotifiedAt so the next depletion cycle can notify again.
 *
 * Throws 'PERK_NOT_FOUND' | 'NOT_CODE_POOL' | 'NO_VALID_CODES'.
 */
export async function addPoolCodes(perkId: string, raw: string): Promise<AddCodesResult> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= 120);
  if (lines.length === 0) throw new Error('NO_VALID_CODES');

  const now = new Date().toISOString();
  return db.update((d) => {
    const perk = (d.perks ?? []).find((p) => p.id === perkId);
    if (!perk) throw new Error('PERK_NOT_FOUND');
    if (perk.fulfillmentType !== 'CODE_POOL') throw new Error('NOT_CODE_POOL');

    if (!Array.isArray(d.perkPoolEntries)) d.perkPoolEntries = [];
    const existing = new Set(
      d.perkPoolEntries.filter((e) => e.perkId === perkId).map((e) => e.code),
    );

    let added = 0;
    let skippedDuplicates = 0;
    for (const code of lines) {
      if (existing.has(code)) {
        skippedDuplicates++;
        continue;
      }
      existing.add(code);
      d.perkPoolEntries.push({
        id: randomUUID(),
        perkId,
        code,
        status: 'AVAILABLE',
        assignedToUserId: null,
        assignedAt: null,
        createdAt: now,
      });
      added++;
    }

    if (added > 0) {
      // Restock — re-arm the low-stock notification for the next cycle.
      perk.lowStockNotifiedAt = null;
      perk.updatedAt = now;
    }
    return { added, skippedDuplicates };
  });
}

export interface PoolEntryWithUser extends PromoCodePoolEntryRecord {
  assignedToEmail: string | null;
  assignedToName: string | null;
}

/**
 * List a perk's pool entries (newest first) with assignee identity for
 * reconciliation. Returns null when the perk doesn't exist.
 */
export async function listPoolEntries(perkId: string): Promise<PoolEntryWithUser[] | null> {
  const data = await db.read();
  const perk = (data.perks ?? []).find((p) => p.id === perkId);
  if (!perk) return null;
  const byId = new Map(data.users.map((u) => [u.id, u]));
  return (data.perkPoolEntries ?? [])
    .filter((e) => e.perkId === perkId)
    .reverse()
    .map((e) => {
      const user = e.assignedToUserId ? byId.get(e.assignedToUserId) : undefined;
      return {
        ...e,
        assignedToEmail: user?.email ?? null,
        assignedToName: user?.fullName ?? null,
      };
    });
}

/* ─────────────────────── User: visible perks ─────────────────────── */

export interface UserPerkView {
  id: string;
  partnerName: string;
  logoUrl: string | null;
  title: string;
  description: string;
  fulfillmentType: PerkRecord['fulfillmentType'];
  minTier: PerkMinTier;
  claimStatus: 'not_claimed' | 'claimed';
  /** CODE_POOL + not_claimed: true when no codes are left to claim. */
  outOfStock: boolean;
  /** Present when claimStatus === 'claimed'. */
  claim: {
    code: string;
    claimedAt: string;
    /** VOUCHER only — public verification path for this voucher. */
    verifyPath?: string;
  } | null;
}

/**
 * Perks visible to `user`: active AND tier-eligible, with the user's claim
 * state attached. (Server-side gate — the same meetsMinTier() also runs
 * inside claimPerk, so this list is a convenience, not the enforcement.)
 */
export async function listPerksForUser(user: UserRecord): Promise<UserPerkView[]> {
  const data = await db.read();
  const entries = data.perkPoolEntries ?? [];
  const vouchers = data.perkVouchers ?? [];

  return (data.perks ?? [])
    .filter((p) => p.active && meetsMinTier(user, p.minTier))
    .map((p): UserPerkView => {
      const base = {
        id: p.id,
        partnerName: p.partnerName,
        logoUrl: p.logoUrl,
        title: p.title,
        description: p.description,
        fulfillmentType: p.fulfillmentType,
        minTier: p.minTier,
      };
      if (p.fulfillmentType === 'CODE_POOL') {
        const mine = entries.find(
          (e) => e.perkId === p.id && e.assignedToUserId === user.id,
        );
        return {
          ...base,
          claimStatus: mine ? 'claimed' : 'not_claimed',
          outOfStock: mine
            ? false
            : !entries.some((e) => e.perkId === p.id && e.status === 'AVAILABLE'),
          claim: mine ? { code: mine.code, claimedAt: mine.assignedAt ?? mine.createdAt } : null,
        };
      }
      const mine = vouchers.find(
        (v) => v.perkId === p.id && v.userId === user.id && !v.superseded,
      );
      return {
        ...base,
        claimStatus: mine ? 'claimed' : 'not_claimed',
        outOfStock: false,
        claim: mine
          ? { code: mine.code, claimedAt: mine.issuedAt, verifyPath: `/verify/${mine.code}` }
          : null,
      };
    });
}

/* ─────────────────────── User: claim ─────────────────────── */

/** Payload the route uses to fire the (non-blocking) admin low-stock email. */
export interface LowStockInfo {
  perkId: string;
  perkTitle: string;
  partnerName: string;
  remaining: number;
  threshold: number;
}

export type ClaimResult =
  | { ok: true; kind: 'CODE_POOL'; code: string; lowStock: LowStockInfo | null }
  | { ok: true; kind: 'VOUCHER'; code: string; issuedAt: string; verifyPath: string }
  | {
      ok: false;
      reason:
        | 'PERK_NOT_FOUND'
        | 'PERK_INACTIVE'
        | 'TIER_TOO_LOW'
        | 'ALREADY_CLAIMED'
        | 'OUT_OF_STOCK'
        | 'USER_NOT_FOUND';
    };

const VOUCHER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** "MTW-" + 6 alphanumerics, e.g. MTW-7K2QF9. */
function generateVoucherCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += VOUCHER_ALPHABET[randomInt(VOUCHER_ALPHABET.length)];
  }
  return `MTW-${suffix}`;
}

/**
 * Claim a perk for `userId`. Fully atomic — every check (perk state, tier,
 * duplicate claim, stock) re-runs INSIDE db.update() against live data, so
 * a stale pre-read can never over-assign a code (same TOCTOU discipline as
 * the password-change flow).
 *
 * CODE_POOL: assigns the first AVAILABLE entry; hard-rejects a second claim.
 * VOUCHER:   supersedes any prior voucher for this user+perk and issues a
 *            fresh one (covers the re-claim-after-renewal case; harmless
 *            refresh otherwise — approved design).
 *
 * Low-stock: when the assignment drops AVAILABLE below the threshold and no
 * notification is pending, lowStockNotifiedAt is stamped IN-LOCK (so exactly
 * one claim wins the right to notify) and the info is returned for the route
 * to email AFTER the lock — the email can never block or fail the claim.
 */
export async function claimPerk(userId: string, perkId: string): Promise<ClaimResult> {
  const now = new Date().toISOString();
  return db.update((d): ClaimResult => {
    const perk = (d.perks ?? []).find((p) => p.id === perkId);
    if (!perk) return { ok: false, reason: 'PERK_NOT_FOUND' };
    if (!perk.active) return { ok: false, reason: 'PERK_INACTIVE' };

    const user = d.users.find((u) => u.id === userId);
    if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };
    if (!meetsMinTier(user, perk.minTier)) return { ok: false, reason: 'TIER_TOO_LOW' };

    if (perk.fulfillmentType === 'CODE_POOL') {
      if (!Array.isArray(d.perkPoolEntries)) d.perkPoolEntries = [];
      const pool = d.perkPoolEntries.filter((e) => e.perkId === perk.id);

      // One finite code per user — a pool claim is never repeatable.
      if (pool.some((e) => e.assignedToUserId === userId)) {
        return { ok: false, reason: 'ALREADY_CLAIMED' };
      }

      const entry = pool.find((e) => e.status === 'AVAILABLE');
      if (!entry) return { ok: false, reason: 'OUT_OF_STOCK' };

      entry.status = 'ASSIGNED';
      entry.assignedToUserId = userId;
      entry.assignedAt = now;

      // Low-stock check — stamped in-lock, emailed after the lock.
      let lowStock: LowStockInfo | null = null;
      const remaining = pool.filter((e) => e.status === 'AVAILABLE').length;
      if (
        perk.lowStockThreshold !== null &&
        remaining < perk.lowStockThreshold &&
        !perk.lowStockNotifiedAt
      ) {
        perk.lowStockNotifiedAt = now;
        perk.updatedAt = now;
        lowStock = {
          perkId: perk.id,
          perkTitle: perk.title,
          partnerName: perk.partnerName,
          remaining,
          threshold: perk.lowStockThreshold,
        };
      }
      return { ok: true, kind: 'CODE_POOL', code: entry.code, lowStock };
    }

    // VOUCHER — supersede any prior voucher and issue a fresh one.
    if (!Array.isArray(d.perkVouchers)) d.perkVouchers = [];
    for (const v of d.perkVouchers) {
      if (v.perkId === perk.id && v.userId === userId && !v.superseded) {
        v.superseded = true;
      }
    }

    // Codes are the public /verify lookup key → globally unique. Collision
    // odds are ~1/2.2e9 per try; the retry loop is pure paranoia.
    const taken = new Set(d.perkVouchers.map((v) => v.code));
    let code = generateVoucherCode();
    for (let i = 0; i < 20 && taken.has(code); i++) code = generateVoucherCode();
    if (taken.has(code)) throw new Error('VOUCHER_CODE_COLLISION');

    d.perkVouchers.push({
      id: randomUUID(),
      perkId: perk.id,
      userId,
      code,
      issuedAt: now,
      superseded: false,
      createdAt: now,
    });
    return { ok: true, kind: 'VOUCHER', code, issuedAt: now, verifyPath: `/verify/${code}` };
  });
}

/* ─────────────────────── Public: voucher verification ─────────────────────── */

export interface VerifyVoucherResult {
  status: 'ACTIVE' | 'EXPIRED';
  /** True when this voucher was superseded by a newer one. */
  replaced: boolean;
  /** "Ahmed B." — first name + last initial only. Never full identity. */
  holderName: string;
  /** Holder's CURRENT normalized tier (live, never cached on the voucher). */
  tier: 'FREE' | 'BUILDER' | 'FOUNDER';
  perkTitle: string;
  partnerName: string;
  logoUrl: string | null;
  issuedAt: string;
  /** Live membership expiry from the holder's account, when set. */
  membershipExpiresAt: string | null;
}

/** "Ahmed Benali" → "Ahmed B."; single-word names pass through unchanged. */
function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return 'Member';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last?.charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/**
 * Public lookup by voucher code. Returns null when the code doesn't resolve
 * (callers must reply with a generic 404 — never hint at valid patterns).
 *
 * Status is computed LIVE: superseded → EXPIRED; otherwise ACTIVE iff the
 * holder's CURRENT effective membership still meets the perk's minTier
 * (expiry included via getEffectiveMembershipCode).
 */
export async function verifyVoucher(code: string): Promise<VerifyVoucherResult | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const data = await db.read();
  const voucher = (data.perkVouchers ?? []).find((v) => v.code === normalized);
  if (!voucher) return null;
  const perk = (data.perks ?? []).find((p) => p.id === voucher.perkId);
  if (!perk) return null;

  const user = data.users.find((u) => u.id === voucher.userId);
  const live = !!user && !voucher.superseded && meetsMinTier(user, perk.minTier);

  return {
    status: live ? 'ACTIVE' : 'EXPIRED',
    replaced: voucher.superseded,
    holderName: user ? shortName(user.fullName) : 'Member',
    tier: user ? normalizedTier(getEffectiveMembershipCode(user)) : 'FREE',
    perkTitle: perk.title,
    partnerName: perk.partnerName,
    logoUrl: perk.logoUrl,
    issuedAt: voucher.issuedAt,
    membershipExpiresAt: user?.membershipExpiresAt ?? null,
  };
}
