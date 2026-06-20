/**
 * Partner Program — PER-INCUBATOR model.
 *
 * The Partner Program is configured per-incubator: enrolling an incubator
 * creates ONE PartnerMembershipRecord (keyed by `incubatorId`). All of that
 * incubator's coworking / training-room / domiciliation spaces become
 * network-bookable by default; private offices default OFF. Each space keeps a
 * per-space `networkBookable` toggle so individual spaces can opt in/out.
 *
 * Integration contract (unchanged): the booking gate, payout resolution and
 * check-in path all read the DENORMALISED space fields
 *   - `space.isPartnerInNetwork`  (gate)
 *   - `space.partnerMembershipId` (→ payout rate)
 * so this service keeps those in sync rather than touching the booking layer.
 *
 * Design constraints (same as the rest of the server layer):
 *   - Plain exported async functions — no classes.
 *   - `db.read()` / `db.update()` — no Prisma.
 *   - All new record fields optional for backward compatibility.
 *   - Fire-and-forget `appendAuditLog` on every admin mutation.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type PartnerMembershipRecord,
  type SpaceRecord,
} from '@/server/db/store';
import type { SpaceCategory } from '@/types/domain';
import { appendAuditLog } from '@/server/audit/service';

const DEFAULT_PAYOUT = 300;

/**
 * Default per-space network-bookability by category. Private offices are OFF;
 * coworking, training rooms and domiciliation are ON.
 */
export function defaultNetworkBookable(category: SpaceCategory): boolean {
  return category !== 'PRIVATE_OFFICE';
}

function clampDiscount(pct: number): number {
  return Math.min(99, Math.max(1, Math.round(pct)));
}

/**
 * Recompute a space's denormalised partner flags from its incubator's partner
 * record. Mutates the space in place (call inside a db.update critical section).
 */
function syncSpaceFlags(space: SpaceRecord, partner: PartnerMembershipRecord | undefined): void {
  if (!partner || !partner.isActive) {
    space.isPartnerInNetwork = false;
    return;
  }
  space.partnerMembershipId = partner.id;
  const bookable = space.networkBookable ?? defaultNetworkBookable(space.category);
  space.networkBookable = bookable;
  space.isPartnerInNetwork = partner.acceptNetworkPasses && bookable;
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time migration: per-space → per-incubator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consolidate legacy per-space PartnerMembershipRecords into one per-incubator
 * record. Idempotent — guarded by `meta.partnerPerIncubatorMigratedAt`.
 *
 *  - Groups legacy records (have `spaceId`, no `incubatorId`) by their space's
 *    incubator. The first (preferably active) record becomes the canonical
 *    incubator-level record (its id is preserved, so its existing promo codes
 *    stay valid). The rest are deactivated after their promo codes /
 *    affiliations are re-pointed to the canonical record (no data loss).
 *  - Preserves the currently-bookable set: only previously-enrolled spaces get
 *    `networkBookable = true`; the incubator's other spaces get `false`.
 *  - Financial history (network visits keyed by spaceId, payouts) is untouched.
 */
export async function ensurePartnerPerIncubatorMigration(): Promise<void> {
  const data = await db.read();
  if (data.meta?.partnerPerIncubatorMigratedAt) return;

  await db.update((d) => {
    if (d.meta?.partnerPerIncubatorMigratedAt) return; // re-check inside the lock
    if (!d.meta) d.meta = {};

    const memberships = d.partnerMemberships ?? [];
    const spaces = d.spaces ?? [];
    const now = new Date().toISOString();

    // Legacy = per-space record not yet attached to an incubator.
    const legacy = memberships.filter((p) => p.spaceId && !p.incubatorId);

    const byIncubator = new Map<string, PartnerMembershipRecord[]>();
    for (const rec of legacy) {
      const space = spaces.find((s) => s.id === rec.spaceId);
      if (!space) continue; // orphaned record — leave untouched
      const arr = byIncubator.get(space.incubatorId) ?? [];
      arr.push(rec);
      byIncubator.set(space.incubatorId, arr);
    }

    for (const [incubatorId, recs] of byIncubator) {
      const canonical = recs.find((r) => r.isActive) ?? recs[0];
      if (!canonical) continue;
      canonical.incubatorId = incubatorId;
      canonical.updatedAt = now;

      const enrolledSpaceIds = new Set(
        recs.map((r) => r.spaceId).filter((id): id is string => Boolean(id)),
      );

      // Re-point promo codes + affiliations from non-canonical records, then
      // deactivate them (kept for traceability — fully reversible, no deletion).
      for (const rec of recs) {
        if (rec.id === canonical.id) continue;
        for (const code of d.partnerPromoCodes ?? []) {
          if (code.partnerId === rec.id) code.partnerId = canonical.id;
        }
        for (const aff of d.userPartnerAffiliations ?? []) {
          if (aff.partnerId === rec.id) aff.partnerId = canonical.id;
        }
        rec.isActive = false;
        rec.supersededByIncubatorId = incubatorId;
        rec.updatedAt = now;
      }

      // Set per-space flags for every space of this incubator. Preserve the
      // currently-bookable set (only previously-enrolled spaces stay ON).
      for (const space of spaces.filter((s) => s.incubatorId === incubatorId)) {
        const wasEnrolled = enrolledSpaceIds.has(space.id);
        space.networkBookable = wasEnrolled;
        space.partnerMembershipId = canonical.id;
        space.isPartnerInNetwork = canonical.isActive && canonical.acceptNetworkPasses && wasEnrolled;
        space.updatedAt = now;
      }
    }

    d.meta.partnerPerIncubatorMigratedAt = now;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrolment / settings (per incubator)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrollIncubatorInput {
  incubatorId: string;
  offerDiscountedMemberships?: boolean;
  discountPercentage?: number;
  acceptNetworkPasses?: boolean;
  networkPayoutRate?: number;
  maxNetworkUsersPerDay?: number | null;
  maxDiscountedMembers?: number | null;
}

export interface UpdateIncubatorPartnerInput {
  offerDiscountedMemberships?: boolean;
  discountPercentage?: number;
  acceptNetworkPasses?: boolean;
  networkPayoutRate?: number;
  maxNetworkUsersPerDay?: number | null;
  maxDiscountedMembers?: number | null;
  isActive?: boolean;
}

function applySettings(
  record: PartnerMembershipRecord,
  input: UpdateIncubatorPartnerInput,
): void {
  if (input.isActive !== undefined) record.isActive = input.isActive;
  if (input.offerDiscountedMemberships !== undefined)
    record.offerDiscountedMemberships = input.offerDiscountedMemberships;
  if (input.discountPercentage !== undefined)
    record.discountPercentage = clampDiscount(input.discountPercentage);
  if (input.maxDiscountedMembers !== undefined)
    record.maxDiscountedMembers = input.maxDiscountedMembers;
  if (input.acceptNetworkPasses !== undefined)
    record.acceptNetworkPasses = input.acceptNetworkPasses;
  if (input.networkPayoutRate !== undefined)
    record.networkPayoutRate = Math.max(0, input.networkPayoutRate);
  if (input.maxNetworkUsersPerDay !== undefined)
    record.maxNetworkUsersPerDay = input.maxNetworkUsersPerDay;
}

/**
 * Enroll an incubator in the Partner Program (idempotent — reactivates an
 * existing record). On join, every coworking/training/domiciliation space
 * becomes network-bookable by default; private offices default OFF. Existing
 * per-space toggles are preserved.
 */
export async function enrollIncubator(
  input: EnrollIncubatorInput,
  adminId: string,
  adminEmail: string,
): Promise<PartnerMembershipRecord> {
  await ensurePartnerPerIncubatorMigration();

  const partner = await db.update<PartnerMembershipRecord>((d) => {
    const inc = (d.incubators ?? []).find((i) => i.id === input.incubatorId);
    if (!inc) throw new Error(`enrollIncubator: incubator ${input.incubatorId} not found`);
    if (!Array.isArray(d.partnerMemberships)) d.partnerMemberships = [];

    const now = new Date().toISOString();
    let record = d.partnerMemberships.find((p) => p.incubatorId === input.incubatorId);

    if (record) {
      record.isActive = true;
      applySettings(record, input);
      record.updatedAt = now;
      record.lastUpdatedBy = adminId;
    } else {
      record = {
        id: randomUUID(),
        incubatorId: input.incubatorId,
        spaceId: null,
        isActive: true,
        offerDiscountedMemberships: input.offerDiscountedMemberships ?? false,
        discountPercentage: clampDiscount(input.discountPercentage ?? 50),
        maxDiscountedMembers: input.maxDiscountedMembers ?? null,
        discountedMembersCount: 0,
        acceptNetworkPasses: input.acceptNetworkPasses ?? true,
        networkPayoutRate: Math.max(0, input.networkPayoutRate ?? DEFAULT_PAYOUT),
        maxNetworkUsersPerDay: input.maxNetworkUsersPerDay ?? null,
        createdAt: now,
        updatedAt: now,
        lastUpdatedBy: adminId,
      };
      d.partnerMemberships.push(record);
    }

    // Default + sync per-space flags. networkBookable is only defaulted when
    // unset, so manual per-space opt-outs survive re-enrolment.
    for (const space of (d.spaces ?? []).filter((s) => s.incubatorId === input.incubatorId)) {
      if (space.networkBookable === undefined) {
        space.networkBookable = defaultNetworkBookable(space.category);
      }
      syncSpaceFlags(space, record);
      space.updatedAt = now;
    }

    return record;
  });

  void appendAuditLog({
    adminId,
    adminEmail,
    action: 'PARTNER_ENROLLED',
    targetType: 'partner_membership',
    targetId: partner.id,
    details: { incubatorId: input.incubatorId },
  });

  return partner;
}

/** Update an incubator's partner settings and re-sync its spaces' flags. */
export async function updateIncubatorPartnerSettings(
  incubatorId: string,
  input: UpdateIncubatorPartnerInput,
  adminId: string,
  adminEmail: string,
): Promise<PartnerMembershipRecord> {
  await ensurePartnerPerIncubatorMigration();

  const partner = await db.update<PartnerMembershipRecord>((d) => {
    const record = (d.partnerMemberships ?? []).find((p) => p.incubatorId === incubatorId);
    if (!record) throw new Error(`updateIncubatorPartnerSettings: no partner record for incubator ${incubatorId}`);

    const now = new Date().toISOString();
    applySettings(record, input);
    record.updatedAt = now;
    record.lastUpdatedBy = adminId;

    for (const space of (d.spaces ?? []).filter((s) => s.incubatorId === incubatorId)) {
      syncSpaceFlags(space, record);
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
    details: { incubatorId, ...input },
  });

  return partner;
}

/** Deactivate an incubator's partner enrolment (kept for history). */
export async function unenrollIncubator(
  incubatorId: string,
  adminId: string,
  adminEmail: string,
): Promise<void> {
  await ensurePartnerPerIncubatorMigration();

  let partnerId = '';
  await db.update((d) => {
    const record = (d.partnerMemberships ?? []).find((p) => p.incubatorId === incubatorId);
    if (!record) return;
    const now = new Date().toISOString();
    record.isActive = false;
    record.updatedAt = now;
    record.lastUpdatedBy = adminId;
    partnerId = record.id;

    for (const space of (d.spaces ?? []).filter((s) => s.incubatorId === incubatorId)) {
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
      details: { incubatorId },
    });
  }
}

/** Toggle a single space's network-bookability (per-space opt in/out). */
export async function setSpaceNetworkBookable(
  spaceId: string,
  networkBookable: boolean,
  adminId: string,
  adminEmail: string,
): Promise<{ spaceId: string; networkBookable: boolean; isPartnerInNetwork: boolean }> {
  await ensurePartnerPerIncubatorMigration();

  const result = await db.update<{ spaceId: string; networkBookable: boolean; isPartnerInNetwork: boolean }>((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === spaceId);
    if (!space) throw new Error(`setSpaceNetworkBookable: space ${spaceId} not found`);
    const record = (d.partnerMemberships ?? []).find((p) => p.incubatorId === space.incubatorId);
    if (!record || !record.isActive) {
      throw new Error(`setSpaceNetworkBookable: incubator ${space.incubatorId} is not an active partner`);
    }

    space.networkBookable = networkBookable;
    syncSpaceFlags(space, record);
    space.updatedAt = new Date().toISOString();

    return {
      spaceId: space.id,
      networkBookable: space.networkBookable ?? false,
      isPartnerInNetwork: space.isPartnerInNetwork ?? false,
    };
  });

  void appendAuditLog({
    adminId,
    adminEmail,
    action: 'PARTNER_SETTINGS_UPDATED',
    targetType: 'space',
    targetId: spaceId,
    details: { networkBookable },
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────────────────────

export interface IncubatorPartnerSpace {
  id: string;
  name: string;
  category: SpaceCategory;
  networkBookable: boolean;
  isPartnerInNetwork: boolean;
}

export interface IncubatorPartnerListItem {
  partner: PartnerMembershipRecord;
  incubatorId: string;
  incubatorName: string;
  /** Alias of incubatorName — kept for back-compat with the promo-code partner picker. */
  spaceName: string;
  spaces: IncubatorPartnerSpace[];
}

/** List per-incubator partner enrolments (runs the migration first). */
export async function listIncubatorPartners(): Promise<IncubatorPartnerListItem[]> {
  await ensurePartnerPerIncubatorMigration();
  const data = await db.read();

  const incById = new Map((data.incubators ?? []).map((i) => [i.id, i]));
  const spaces = data.spaces ?? [];

  return (data.partnerMemberships ?? [])
    .filter((p) => p.incubatorId)
    .map((partner) => {
      const incubatorId = partner.incubatorId as string;
      const inc = incById.get(incubatorId);
      const incubatorName = inc?.name ?? 'Unknown incubator';
      const incubatorSpaces: IncubatorPartnerSpace[] = spaces
        .filter((s) => s.incubatorId === incubatorId)
        .map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          networkBookable: s.networkBookable ?? defaultNetworkBookable(s.category),
          isPartnerInNetwork: s.isPartnerInNetwork ?? false,
        }));
      return { partner, incubatorId, incubatorName, spaceName: incubatorName, spaces: incubatorSpaces };
    })
    .sort((a, b) => a.incubatorName.localeCompare(b.incubatorName));
}
