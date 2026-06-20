/**
 * Partner Membership Service — enrolment, settings, and stats for partner spaces.
 *
 * A "partner space" is any SpaceRecord whose owning incubator has opted in to
 * the Partner Program. Opting in creates a PartnerMembershipRecord linked to
 * the SpaceRecord; opting out sets isActive = false (we keep the record for
 * the visit/payout history).
 *
 * Design constraints (same as the rest of the server layer):
 *   - Plain exported async functions — no classes.
 *   - `db.read()` / `db.update()` — no Prisma.
 *   - All new record fields are optional for backward compatibility.
 *   - Fire-and-forget `appendAuditLog` on every admin mutation.
 *   - 0 TypeScript errors.
 */

import { randomUUID } from 'node:crypto';
import {
  db,
  type PartnerMembershipRecord,
  type NetworkVisitRecord,
  type PartnerPromoCodeRecord,
  type UserRecord,
} from '@/server/db/store';
import { appendAuditLog } from '@/server/audit/service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrollSpaceInput {
  /** SpaceRecord.id to enroll. */
  spaceId: string;
  offerDiscountedMemberships?: boolean;
  discountPercentage?: number;
  acceptNetworkPasses?: boolean;
  networkPayoutRate?: number;
  maxNetworkUsersPerDay?: number | null;
  maxDiscountedMembers?: number | null;
}

export interface UpdatePartnerSettingsInput {
  offerDiscountedMemberships?: boolean;
  discountPercentage?: number;
  acceptNetworkPasses?: boolean;
  networkPayoutRate?: number;
  maxNetworkUsersPerDay?: number | null;
  maxDiscountedMembers?: number | null;
  isActive?: boolean;
}

export interface PartnerStats {
  partnerId: string;
  spaceId: string;
  spaceName: string;
  /** Total network visits accepted. */
  totalVisits: number;
  /** Network visits this calendar month. */
  visitsThisMonth: number;
  /** Total payout earned (DZD, PENDING + PAID). */
  totalPayoutEarned: number;
  /** Pending payout (not yet disbursed). */
  pendingPayout: number;
  /** Number of promo codes issued by this partner. */
  promoCodesIssued: number;
  /** Number of promo codes already redeemed. */
  promoCodesRedeemed: number;
  /** Number of unique users referred via this partner's promo codes. */
  uniqueReferrals: number;
  /** Daily network visitor counts for the last 30 days (oldest first). */
  dailyVisits: Array<{ date: string; count: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. enrollSpace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enroll a space in the Partner Program. If the space already has a partner
 * record (even inactive), reactivates it and returns the updated record.
 *
 * Throws when the space does not exist.
 */
export async function enrollSpace(
  input: EnrollSpaceInput,
  adminId: string,
  adminEmail: string,
): Promise<PartnerMembershipRecord> {
  const { spaceId } = input;

  const partner = await db.update<PartnerMembershipRecord>((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === spaceId);
    if (!space) throw new Error(`enrollSpace: space ${spaceId} not found`);

    if (!Array.isArray(d.partnerMemberships)) d.partnerMemberships = [];

    // Idempotency — if a record already exists for this space, reactivate it.
    const existing = d.partnerMemberships.find((p) => p.spaceId === spaceId);
    const now = new Date().toISOString();

    if (existing) {
      existing.isActive = true;
      if (input.offerDiscountedMemberships !== undefined)
        existing.offerDiscountedMemberships = input.offerDiscountedMemberships;
      if (input.discountPercentage !== undefined)
        existing.discountPercentage = clampDiscount(input.discountPercentage);
      if (input.acceptNetworkPasses !== undefined)
        existing.acceptNetworkPasses = input.acceptNetworkPasses;
      if (input.networkPayoutRate !== undefined)
        existing.networkPayoutRate = Math.max(0, input.networkPayoutRate);
      if (input.maxNetworkUsersPerDay !== undefined)
        existing.maxNetworkUsersPerDay = input.maxNetworkUsersPerDay;
      if (input.maxDiscountedMembers !== undefined)
        existing.maxDiscountedMembers = input.maxDiscountedMembers;
      existing.updatedAt = now;
      existing.lastUpdatedBy = adminId;

      // Sync the denormalised flag on the space
      space.partnerMembershipId = existing.id;
      space.isPartnerInNetwork = existing.acceptNetworkPasses;
      space.updatedAt = now;

      return existing;
    }

    // New enrolment
    const record: PartnerMembershipRecord = {
      id: randomUUID(),
      spaceId,
      isActive: true,
      offerDiscountedMemberships: input.offerDiscountedMemberships ?? false,
      discountPercentage: clampDiscount(input.discountPercentage ?? 50),
      maxDiscountedMembers: input.maxDiscountedMembers ?? null,
      discountedMembersCount: 0,
      acceptNetworkPasses: input.acceptNetworkPasses ?? true,
      networkPayoutRate: Math.max(0, input.networkPayoutRate ?? 300),
      maxNetworkUsersPerDay: input.maxNetworkUsersPerDay ?? null,
      createdAt: now,
      updatedAt: now,
      lastUpdatedBy: adminId,
    };

    d.partnerMemberships.push(record);

    // Sync denormalised fields on the space
    space.partnerMembershipId = record.id;
    space.isPartnerInNetwork = record.acceptNetworkPasses;
    space.updatedAt = now;

    return record;
  });

  // Fire-and-forget audit log
  void appendAuditLog({
    adminId,
    adminEmail,
    action: 'PARTNER_ENROLLED',
    targetType: 'partner_membership',
    targetId: partner.id,
    details: { spaceId },
  });

  return partner;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. unenrollSpace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deactivate a space's Partner Program enrolment. The PartnerMembershipRecord
 * is kept (for audit and payout history); isActive is set to false.
 *
 * No-ops gracefully if the space is not enrolled.
 */
export async function unenrollSpace(
  spaceId: string,
  adminId: string,
  adminEmail: string,
): Promise<void> {
  let partnerId = '';

  await db.update((d) => {
    const partner = (d.partnerMemberships ?? []).find((p) => p.spaceId === spaceId);
    if (!partner) return;

    const now = new Date().toISOString();
    partner.isActive = false;
    partner.updatedAt = now;
    partner.lastUpdatedBy = adminId;
    partnerId = partner.id;

    // Clear the denormalised flags on the space
    const space = (d.spaces ?? []).find((s) => s.id === spaceId);
    if (space) {
      space.isPartnerInNetwork = false;
      space.updatedAt = now;
    }
  });

  if (partnerId) {
    void appendAuditLog({
      adminId,
      adminEmail,
      action: 'PARTNER_UNENROLLED',
      targetType: 'partner_membership',
      targetId: partnerId,
      details: { spaceId },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. updatePartnerSettings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update settings on an existing PartnerMembershipRecord. Throws when the
 * space has no partner record.
 */
export async function updatePartnerSettings(
  spaceId: string,
  settings: UpdatePartnerSettingsInput,
  adminId: string,
  adminEmail: string,
): Promise<PartnerMembershipRecord> {
  const partner = await db.update<PartnerMembershipRecord>((d) => {
    const record = (d.partnerMemberships ?? []).find((p) => p.spaceId === spaceId);
    if (!record) throw new Error(`updatePartnerSettings: no partner record for space ${spaceId}`);

    const now = new Date().toISOString();

    if (settings.isActive !== undefined) record.isActive = settings.isActive;
    if (settings.offerDiscountedMemberships !== undefined)
      record.offerDiscountedMemberships = settings.offerDiscountedMemberships;
    if (settings.discountPercentage !== undefined)
      record.discountPercentage = clampDiscount(settings.discountPercentage);
    if (settings.maxDiscountedMembers !== undefined)
      record.maxDiscountedMembers = settings.maxDiscountedMembers;
    if (settings.acceptNetworkPasses !== undefined)
      record.acceptNetworkPasses = settings.acceptNetworkPasses;
    if (settings.networkPayoutRate !== undefined)
      record.networkPayoutRate = Math.max(0, settings.networkPayoutRate);
    if (settings.maxNetworkUsersPerDay !== undefined)
      record.maxNetworkUsersPerDay = settings.maxNetworkUsersPerDay;

    record.updatedAt = now;
    record.lastUpdatedBy = adminId;

    // Keep denormalised flag in sync
    const space = (d.spaces ?? []).find((s) => s.id === spaceId);
    if (space) {
      space.isPartnerInNetwork = record.isActive && record.acceptNetworkPasses;
      space.updatedAt = now;
    }

    return record;
  });

  void appendAuditLog({
    adminId,
    adminEmail,
    action: 'PARTNER_SETTINGS_UPDATED',
    targetType: 'partner_membership',
    targetId: partner.id,
    details: { spaceId, ...settings },
  });

  return partner;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. getPartnerStats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute aggregate statistics for a partner space. All calculations are done
 * in-memory from the store (no external data source).
 */
export async function getPartnerStats(partnerId: string): Promise<PartnerStats> {
  const data = await db.read();

  const partner = (data.partnerMemberships ?? []).find((p) => p.id === partnerId);
  if (!partner) throw new Error(`getPartnerStats: partner ${partnerId} not found`);

  const space = (data.spaces ?? []).find((s) => s.id === partner.spaceId);
  const spaceName = space?.name ?? 'Unknown space';

  // Visits for this partner's space
  const visits = (data.networkVisits ?? []).filter(
    (v) => v.spaceId === partner.spaceId && v.checkedInAt,
  );

  const nowMs = Date.now();
  const thisMonthStart = new Date(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    1,
  ).getTime();

  const visitsThisMonth = visits.filter(
    (v) => v.checkedInAt && Date.parse(v.checkedInAt) >= thisMonthStart,
  ).length;

  const totalPayoutEarned = visits.reduce((sum, v) => sum + v.payoutAmount, 0);
  const pendingPayout = visits
    .filter((v) => v.payoutStatus === 'PENDING')
    .reduce((sum, v) => sum + v.payoutAmount, 0);

  // Promo codes
  const codes = (data.partnerPromoCodes ?? []).filter(
    (c) => c.partnerId === partnerId,
  );
  const promoCodesIssued = codes.length;
  const promoCodesRedeemed = codes.filter((c) => c.isUsed).length;

  // Unique referrals (distinct users who used a code from this partner)
  const affiliations = (data.userPartnerAffiliations ?? []).filter(
    (a) => a.partnerId === partnerId,
  );
  const uniqueReferrals = new Set(affiliations.map((a) => a.userId)).size;

  // Daily visits for the last 30 days
  const thirtyDaysAgo = nowMs - 30 * 86_400_000;
  const dailyMap = new Map<string, number>();
  for (let d = 0; d < 30; d++) {
    const dateStr = new Date(nowMs - d * 86_400_000).toISOString().slice(0, 10);
    dailyMap.set(dateStr, 0);
  }
  for (const v of visits) {
    if (!v.checkedInAt) continue;
    const ms = Date.parse(v.checkedInAt);
    if (ms < thirtyDaysAgo) continue;
    const day = v.checkedInAt.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }
  const dailyVisits = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return {
    partnerId,
    spaceId: partner.spaceId ?? '',
    spaceName,
    totalVisits: visits.length,
    visitsThisMonth,
    totalPayoutEarned,
    pendingPayout,
    promoCodesIssued,
    promoCodesRedeemed,
    uniqueReferrals,
    dailyVisits,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. listPartners
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all partner enrolments, optionally filtered by active status.
 * Joins the SpaceRecord for the display name.
 */
export interface PartnerListItem {
  partner: PartnerMembershipRecord;
  spaceName: string;
  incubatorName: string;
}

export async function listPartners(opts: {
  activeOnly?: boolean;
} = {}): Promise<PartnerListItem[]> {
  const data = await db.read();
  let partners = data.partnerMemberships ?? [];

  if (opts.activeOnly) {
    partners = partners.filter((p) => p.isActive);
  }

  const spaceById = new Map((data.spaces ?? []).map((s) => [s.id, s]));

  return partners.map((p) => {
    const space = p.spaceId ? spaceById.get(p.spaceId) : undefined;
    return {
      partner: p,
      spaceName: space?.name ?? 'Unknown space',
      incubatorName: space?.incubatorName ?? 'Unknown incubator',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clampDiscount(pct: number): number {
  return Math.min(99, Math.max(1, Math.round(pct)));
}
