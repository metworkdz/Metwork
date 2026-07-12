/**
 * Partner Promo Code Service — generation, validation, and redemption of
 * discounted-membership promo codes issued by partner spaces.
 *
 * Security model:
 *   - Codes are stored as SHA-256 hashes (via hashCode from qr-utils).
 *   - Plaintext codes are only returned at generation time and MUST be
 *     immediately forwarded to the user (e.g. via email).  They cannot be
 *     recovered from the DB.
 *   - `validatePromoCode` does a constant-time hash compare.
 *   - Codes are one-time-use and expire after `validUntil`.
 *
 * Design constraints (same as the rest of the server layer):
 *   - Plain exported async functions — no classes.
 *   - `db.read()` / `db.update()` — no Prisma.
 *   - Fire-and-forget `appendAuditLog` on admin mutations.
 *   - 0 TypeScript errors.
 *
 * Code format: "PPT-{SPACE_PREFIX}-{YYYY}-{RANDOM6}"
 *   e.g. "PPT-ORAN-2026-X7K3M2"
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  db,
  type PartnerPromoCodeRecord,
  type PartnerPromoCodeBatchRecord,
  type PartnerPromoCodeTier,
  type UserMembershipRecord,
  type UserPartnerAffiliationRecord,
} from '@/server/db/store';
import { safeHashEquals } from './qr-utils';
import { appendAuditLog } from '@/server/audit/service';
import { createNotification } from '@/server/notifications/create-notification';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateSingleCodeInput {
  /** PartnerMembershipRecord.id */
  partnerId: string;
  membershipTier: PartnerPromoCodeTier;
  /** Defaults to partner's discountPercentage if omitted. */
  discountPercentage?: number;
  /** ISO date — defaults to today + 30 days if omitted. */
  validUntil?: string;
  /** Email the code was generated for (audit trail). */
  createdFor: string;
}

export interface GenerateSingleCodeResult {
  record: PartnerPromoCodeRecord;
  /** Plaintext code — must be emailed to the user immediately. */
  plaintext: string;
}

export interface GenerateBulkCodesInput {
  partnerId: string;
  membershipTier: PartnerPromoCodeTier;
  count: number;           // 1 – 10 000
  discountPercentage?: number;
  validUntil?: string;
  /** Comma-separated list of email addresses (one per code). Optional. */
  emails?: string[];
}

export interface GenerateBulkCodesResult {
  batch: PartnerPromoCodeBatchRecord;
  /** Parallel array — index matches `batch.count`. */
  codes: Array<{ id: string; plaintext: string; createdFor: string }>;
}

export interface ValidatePromoCodeResult {
  valid: boolean;
  record?: PartnerPromoCodeRecord;
  discountPercentage?: number;
  membershipTier?: PartnerPromoCodeTier;
  error?: string;
}

export interface ApplyPromoCodeResult {
  membership: UserMembershipRecord;
  affiliation: UserPartnerAffiliationRecord;
  discountPercentage: number;
}

export interface PromoCodeStats {
  partnerId: string;
  totalIssued: number;
  totalRedeemed: number;
  totalExpired: number;
  totalActive: number;
  tierBreakdown: { BUILDER: number; FOUNDER: number };
  recentRedemptions: Array<{
    codeId: string;
    usedBy: string;
    usedAt: string;
    membershipTier: PartnerPromoCodeTier;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a plaintext promo code: "PPT-{PREFIX}-{YYYY}-{RAND6}". */
function buildPromoCode(spacePrefix: string, year: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/I/1 confusion
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  const prefix = spacePrefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `PPT-${prefix}-${year}-${rand}`;
}

/** SHA-256 hex of the uppercased plaintext code. */
function hashPromoCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/** Returns today + N days as ISO date (YYYY-MM-DD). */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. generateSingleCode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue a single discount code for one recipient.
 *
 * Returns the plaintext code in the result — callers MUST pass it to
 * `sendResendEmail` (or equivalent) before discarding.
 */
export async function generateSingleCode(
  input: GenerateSingleCodeInput,
  adminId: string,
  adminEmail: string,
): Promise<GenerateSingleCodeResult> {
  const data = await db.read();

  const partner = (data.partnerMemberships ?? []).find((p) => p.id === input.partnerId);
  if (!partner) throw new Error(`generateSingleCode: partner ${input.partnerId} not found`);
  if (!partner.isActive) throw new Error(`generateSingleCode: partner is not active`);
  if (!partner.offerDiscountedMemberships) {
    throw new Error(`generateSingleCode: partner has not enabled discounted memberships`);
  }

  const space = (data.spaces ?? []).find((s) => s.id === partner.spaceId);
  const spacePrefix = space?.name ?? 'PART';

  const year = new Date().getUTCFullYear();
  const discountPct = input.discountPercentage ?? partner.discountPercentage;
  const validUntil = input.validUntil ?? daysFromNow(30);
  const now = new Date().toISOString();

  // Generate until we have a unique code (collision is astronomically unlikely
  // but the loop makes it safe).
  let plaintext = '';
  let codeHash = '';
  await db.update((d) => {
    if (!Array.isArray(d.partnerPromoCodes)) d.partnerPromoCodes = [];
    const existingHashes = new Set(d.partnerPromoCodes.map((c) => c.code));
    do {
      plaintext = buildPromoCode(spacePrefix, year);
      codeHash = hashPromoCode(plaintext);
    } while (existingHashes.has(codeHash));

    const record: PartnerPromoCodeRecord = {
      id: randomUUID(),
      code: codeHash,          // store only hash
      partnerId: input.partnerId,
      batchId: null,
      discountPercentage: discountPct,
      membershipTier: input.membershipTier,
      validFrom: now,
      validUntil,
      isUsed: false,
      usedBy: null,
      usedAt: null,
      usedForMembership: null,
      createdAt: now,
      createdFor: input.createdFor,
    };

    d.partnerPromoCodes.push(record);

    // Return the record via closure — we'll use it below
    (d as unknown as { __lastPromoCode: PartnerPromoCodeRecord }).__lastPromoCode = record;
  });

  // Retrieve the record we just wrote
  const fresh = await db.read();
  const record = (fresh.partnerPromoCodes ?? [])
    .filter((c) => c.partnerId === input.partnerId && c.code === codeHash)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!record) throw new Error('generateSingleCode: failed to retrieve newly written code');

  void appendAuditLog({
    adminId,
    adminEmail,
    action: 'PARTNER_PROMO_CODE_GENERATED',
    targetType: 'partner_promo_code',
    targetId: record.id,
    details: {
      partnerId: input.partnerId,
      membershipTier: input.membershipTier,
      discountPercentage: discountPct,
      createdFor: input.createdFor,
    },
  });

  return { record, plaintext };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. generateBulkCodes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue multiple codes in a single batch. Count is capped at 10 000.
 *
 * Returns a manifest (batch record) and the parallel array of plaintext codes.
 * The caller must persist/distribute the plaintexts — they cannot be recovered.
 */
export async function generateBulkCodes(
  input: GenerateBulkCodesInput,
  adminId: string,
  adminEmail: string,
): Promise<GenerateBulkCodesResult> {
  const count = Math.min(10_000, Math.max(1, input.count));
  const data = await db.read();

  const partner = (data.partnerMemberships ?? []).find((p) => p.id === input.partnerId);
  if (!partner) throw new Error(`generateBulkCodes: partner ${input.partnerId} not found`);
  if (!partner.isActive) throw new Error(`generateBulkCodes: partner is not active`);
  if (!partner.offerDiscountedMemberships) {
    throw new Error(`generateBulkCodes: partner has not enabled discounted memberships`);
  }

  const space = (data.spaces ?? []).find((s) => s.id === partner.spaceId);
  const spacePrefix = space?.name ?? 'PART';
  const year = new Date().getUTCFullYear();
  const discountPct = input.discountPercentage ?? partner.discountPercentage;
  const validUntil = input.validUntil ?? daysFromNow(30);
  const now = new Date().toISOString();

  // Build all records outside the write lock so we minimise lock time
  const generated: Array<{ record: PartnerPromoCodeRecord; plaintext: string }> = [];
  const usedHashes = new Set((data.partnerPromoCodes ?? []).map((c) => c.code));

  const batchId = randomUUID();
  for (let i = 0; i < count; i++) {
    let plaintext = '';
    let codeHash = '';
    let attempts = 0;
    do {
      plaintext = buildPromoCode(spacePrefix, year);
      codeHash = hashPromoCode(plaintext);
      attempts++;
      if (attempts > 100) throw new Error('generateBulkCodes: too many hash collisions');
    } while (usedHashes.has(codeHash));

    usedHashes.add(codeHash);
    const createdFor = input.emails?.[i] ?? '';
    generated.push({
      plaintext,
      record: {
        id: randomUUID(),
        code: codeHash,
        partnerId: input.partnerId,
        batchId,
        discountPercentage: discountPct,
        membershipTier: input.membershipTier,
        validFrom: now,
        validUntil,
        isUsed: false,
        usedBy: null,
        usedAt: null,
        usedForMembership: null,
        createdAt: now,
        createdFor,
      },
    });
  }

  const batch: PartnerPromoCodeBatchRecord = {
    id: batchId,
    partnerId: input.partnerId,
    count,
    membershipTier: input.membershipTier,
    discountPercentage: discountPct,
    validUntil,
    createdAt: now,
    createdBy: adminId,
  };

  await db.update((d) => {
    if (!Array.isArray(d.partnerPromoCodes)) d.partnerPromoCodes = [];
    if (!Array.isArray(d.partnerPromoCodeBatches)) d.partnerPromoCodeBatches = [];
    d.partnerPromoCodeBatches.push(batch);
    for (const g of generated) d.partnerPromoCodes.push(g.record);
  });

  void appendAuditLog({
    adminId,
    adminEmail,
    action: 'PARTNER_PROMO_CODE_BULK_GENERATED',
    targetType: 'partner_promo_code_batch',
    targetId: batchId,
    details: {
      partnerId: input.partnerId,
      count,
      membershipTier: input.membershipTier,
      discountPercentage: discountPct,
    },
  });

  return {
    batch,
    codes: generated.map((g) => ({
      id: g.record.id,
      plaintext: g.plaintext,
      createdFor: g.record.createdFor,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. validatePromoCode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a plaintext promo code is valid and unused.
 * Does NOT consume the code.
 */
export async function validatePromoCode(
  plaintextCode: string,
): Promise<ValidatePromoCodeResult> {
  if (!plaintextCode || typeof plaintextCode !== 'string') {
    return { valid: false, error: 'Invalid code format' };
  }

  const normalized = plaintextCode.trim().toUpperCase();
  const hash = hashPromoCode(normalized);
  const data = await db.read();
  const now = new Date().toISOString();

  const record = (data.partnerPromoCodes ?? []).find((c) =>
    safeHashEquals(c.code, hash),
  );

  if (!record) {
    return { valid: false, error: 'Promo code not found' };
  }
  if (record.isUsed) {
    return { valid: false, error: 'Promo code has already been used' };
  }
  if (record.validUntil < now.slice(0, 10)) {
    return { valid: false, error: 'Promo code has expired' };
  }

  // Check partner is still active
  const partner = (data.partnerMemberships ?? []).find((p) => p.id === record.partnerId);
  if (!partner?.isActive) {
    return { valid: false, error: 'This promo code is no longer active' };
  }

  return {
    valid: true,
    record,
    discountPercentage: record.discountPercentage,
    membershipTier: record.membershipTier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyPromoCode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consume a promo code for a user. Creates (or extends) the UserMembershipRecord
 * at a discount, records the affiliation, updates the user's tier fields, and
 * bumps the partner's `discountedMembersCount`.
 *
 * Throws on any validation failure — callers should call `validatePromoCode`
 * first to surface friendly error messages.
 */
export async function applyPromoCode(
  plaintextCode: string,
  userId: string,
): Promise<ApplyPromoCodeResult> {
  const normalized = plaintextCode.trim().toUpperCase();
  const hash = hashPromoCode(normalized);
  const now = new Date().toISOString();

  const result = await db.update<ApplyPromoCodeResult>((d) => {
    // Locate the code record
    const codeRecord = (d.partnerPromoCodes ?? []).find((c) =>
      safeHashEquals(c.code, hash),
    );
    if (!codeRecord) throw new Error('applyPromoCode: code not found');
    if (codeRecord.isUsed) throw new Error('applyPromoCode: code already used');
    if (codeRecord.validUntil < now.slice(0, 10)) {
      throw new Error('applyPromoCode: code expired');
    }

    // Partner check
    const partner = (d.partnerMemberships ?? []).find(
      (p) => p.id === codeRecord.partnerId,
    );
    if (!partner?.isActive) throw new Error('applyPromoCode: partner no longer active');

    // Cap check
    if (
      partner.maxDiscountedMembers !== null &&
      partner.discountedMembersCount >= partner.maxDiscountedMembers
    ) {
      throw new Error('applyPromoCode: partner has reached maximum discounted members');
    }

    // User uniqueness — one affiliation per (userId, partnerId)
    const existing = (d.userPartnerAffiliations ?? []).find(
      (a) => a.userId === userId && a.partnerId === codeRecord.partnerId,
    );
    if (existing) {
      throw new Error('applyPromoCode: user already affiliated with this partner');
    }

    // Determine membership plan and duration
    const tier = codeRecord.membershipTier; // 'BUILDER' | 'FOUNDER'
    const membershipPlan = tier === 'FOUNDER' ? 'FOUNDER' : 'BUILDER';
    const startsAt = now;
    const expiresAt = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(); // 1 year

    // Cancel any existing active membership (we replace it)
    for (const m of d.userMemberships ?? []) {
      if (m.userId === userId && m.status === 'ACTIVE') {
        m.status = 'CANCELLED';
        m.updatedAt = now;
      }
    }

    // Create new membership record
    if (!Array.isArray(d.userMemberships)) d.userMemberships = [];
    const membership: UserMembershipRecord = {
      id: randomUUID(),
      userId,
      plan: membershipPlan,
      startsAt,
      expiresAt,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    d.userMemberships.push(membership);

    // Create affiliation record
    if (!Array.isArray(d.userPartnerAffiliations)) d.userPartnerAffiliations = [];
    const affiliation: UserPartnerAffiliationRecord = {
      id: randomUUID(),
      userId,
      partnerId: codeRecord.partnerId,
      referredAt: now,
      promoCodeUsed: hashPromoCode(normalized),
    };
    d.userPartnerAffiliations.push(affiliation);

    // Mark code as used
    codeRecord.isUsed = true;
    codeRecord.usedBy = userId;
    codeRecord.usedAt = now;
    codeRecord.usedForMembership = membership.id;

    // Bump partner count
    partner.discountedMembersCount += 1;

    // Update user's tier and credit fields
    const user = (d.users ?? []).find((u) => u.id === userId);
    if (user) {
      const tierType = tier === 'FOUNDER' ? 'FOUNDER' : ('BUILDER' as const);
      user.membershipTier = tierType;
      // Canonical uppercase — every discount/rank map is keyed 'BUILDER'/'FOUNDER'
      // (lowercase writes here previously cost these members all tier discounts).
      user.membershipCode = membershipPlan;
      user.membershipStartDate = startsAt;
      user.membershipRenewalDate = expiresAt;
      user.membershipExpiresAt = expiresAt;
      user.membershipDiscountReceived = codeRecord.discountPercentage;
      user.affiliatedPartnerId = codeRecord.partnerId;
      // Grant credits for the new tier
      const maxCredits = tierType === 'FOUNDER' ? 10 : 3;
      user.networkCreditsMax = maxCredits;
      user.networkCredits = maxCredits;
      user.updatedAt = now;
    }

    return {
      membership,
      affiliation,
      discountPercentage: codeRecord.discountPercentage,
    };
  });

  // Fire-and-forget in-app notification
  void createNotification({
    userId,
    type: 'PARTNER_PROMO_RECEIVED',
    title: 'Membership discount applied!',
    body: `Your promo code has been applied. Your new membership is now active.`,
    href: '/dashboard/membership',
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. getPromoCodeStats
// ─────────────────────────────────────────────────────────────────────────────

export async function getPromoCodeStats(partnerId: string): Promise<PromoCodeStats> {
  const data = await db.read();
  const today = new Date().toISOString().slice(0, 10);

  const codes = (data.partnerPromoCodes ?? []).filter(
    (c) => c.partnerId === partnerId,
  );

  const totalIssued = codes.length;
  const totalRedeemed = codes.filter((c) => c.isUsed).length;
  const totalExpired = codes.filter(
    (c) => !c.isUsed && c.validUntil < today,
  ).length;
  const totalActive = codes.filter(
    (c) => !c.isUsed && c.validUntil >= today,
  ).length;

  const tierBreakdown = { BUILDER: 0, FOUNDER: 0 };
  for (const c of codes) tierBreakdown[c.membershipTier]++;

  const recentRedemptions = codes
    .filter((c) => c.isUsed && c.usedAt)
    .sort((a, b) => (b.usedAt ?? '').localeCompare(a.usedAt ?? ''))
    .slice(0, 20)
    .map((c) => ({
      codeId: c.id,
      usedBy: c.usedBy ?? '',
      usedAt: c.usedAt ?? '',
      membershipTier: c.membershipTier,
    }));

  return {
    partnerId,
    totalIssued,
    totalRedeemed,
    totalExpired,
    totalActive,
    tierBreakdown,
    recentRedemptions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. expireOldCodes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-expires promo codes that have passed their `validUntil` date.
 * Run daily via the cron job at midnight UTC.
 *
 * "Expired" codes are simply those past their date that haven't been used.
 * No mutation is needed — `validatePromoCode` rejects them by date check.
 * This function returns a count for the cron response payload and logs the
 * expired codes for ops visibility.
 *
 * If you ever need to physically remove them (e.g. for storage), this is
 * where you'd do it — currently we keep them for audit purposes.
 */
export async function expireOldCodes(): Promise<{ expired: number; details: string[] }> {
  const data = await db.read();
  const today = new Date().toISOString().slice(0, 10);

  const expired = (data.partnerPromoCodes ?? []).filter(
    (c) => !c.isUsed && c.validUntil < today,
  );

  return {
    expired: expired.length,
    details: expired.map((c) => `${c.id} (partner=${c.partnerId}, expired=${c.validUntil})`),
  };
}
