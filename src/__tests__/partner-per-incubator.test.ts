/**
 * Part E — Partner Program per-incubator migration + enrolment.
 *
 * Verifies:
 *  - the one-time per-space → per-incubator migration is idempotent, preserves
 *    the currently-bookable set, re-points promo codes, and sets category
 *    defaults; legacy duplicates are consolidated (not deleted).
 *  - enrollIncubator defaults coworking/training/domiciliation ON, private OFF.
 *  - setSpaceNetworkBookable toggles the denormalised booking-gate flag.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import {
  ensurePartnerPerIncubatorMigration,
  enrollIncubator,
  setSpaceNetworkBookable,
  listIncubatorPartners,
  defaultNetworkBookable,
} from '@/server/network/partner-incubator-service';

const NOW = '2026-06-01T10:00:00.000Z';
const ADMIN = { id: 'admin-1', email: 'admin@x.com' };

function space(id: string, incubatorId: string, category: string, extra: Record<string, unknown> = {}) {
  return {
    id, incubatorId, incubatorName: 'Inc', name: id, description: 'd',
    category, city: 'Algiers', imageUrl: null, imageUrls: [],
    pricePerHour: 500, pricePerDay: 3000, pricePerMonth: 40000,
    capacity: 5, amenities: [], acceptedPaymentMethods: ['ONLINE'],
    workingDays: [1, 2, 3, 4, 5], openingTime: '09:00', closingTime: '18:00',
    durationDiscounts: [], isActive: true, createdAt: NOW, updatedAt: NOW, ...extra,
  } as never;
}

async function reset() {
  await db.update((d) => {
    d.incubators = [];
    d.spaces = [];
    d.partnerMemberships = [];
    d.partnerPromoCodes = [];
    d.userPartnerAffiliations = [];
    if (!d.meta) d.meta = {};
    d.meta.partnerPerIncubatorMigratedAt = undefined;
  });
}

describe('partner per-incubator migration', () => {
  beforeEach(reset);

  it('consolidates legacy per-space records, preserves bookable set, re-points promo codes', async () => {
    await db.update((d) => {
      d.incubators.push({ id: 'inc-1', name: 'Inc One', status: 'ACTIVE' } as never);
      // Two spaces: coworking enrolled, private office NOT enrolled.
      d.spaces.push(space('cw', 'inc-1', 'COWORKING', { isPartnerInNetwork: true, partnerMembershipId: 'pm-cw' }));
      d.spaces.push(space('po', 'inc-1', 'PRIVATE_OFFICE'));
      d.partnerMemberships.push({
        id: 'pm-cw', spaceId: 'cw', isActive: true, acceptNetworkPasses: true,
        networkPayoutRate: 300, offerDiscountedMemberships: true, discountPercentage: 50,
        maxDiscountedMembers: null, discountedMembersCount: 2, maxNetworkUsersPerDay: null,
        createdAt: NOW, updatedAt: NOW, lastUpdatedBy: null,
      } as never);
      d.partnerPromoCodes.push({ id: 'code-1', partnerId: 'pm-cw', code: 'X', isUsed: false } as never);
    });

    await ensurePartnerPerIncubatorMigration();

    const data = await db.read();
    const canonical = data.partnerMemberships.find((p) => p.incubatorId === 'inc-1')!;
    expect(canonical).toBeTruthy();
    expect(canonical.id).toBe('pm-cw');           // first record repurposed → promo id preserved
    expect(canonical.isActive).toBe(true);
    expect(canonical.networkPayoutRate).toBe(300);

    const cw = data.spaces.find((s) => s.id === 'cw')!;
    const po = data.spaces.find((s) => s.id === 'po')!;
    expect(cw.networkBookable).toBe(true);
    expect(cw.isPartnerInNetwork).toBe(true);
    expect(cw.partnerMembershipId).toBe('pm-cw');
    expect(po.networkBookable).toBe(false);       // was not enrolled → stays off
    expect(po.isPartnerInNetwork).toBe(false);

    // Promo code still resolves to a valid partner record.
    const code = data.partnerPromoCodes.find((c) => c.id === 'code-1')!;
    expect(code.partnerId).toBe('pm-cw');
    expect(data.meta?.partnerPerIncubatorMigratedAt).toBeTruthy();
  });

  it('is idempotent — a second run changes nothing', async () => {
    await db.update((d) => {
      d.incubators.push({ id: 'inc-1', name: 'Inc', status: 'ACTIVE' } as never);
      d.spaces.push(space('cw', 'inc-1', 'COWORKING', { isPartnerInNetwork: true, partnerMembershipId: 'pm-cw' }));
      d.partnerMemberships.push({
        id: 'pm-cw', spaceId: 'cw', isActive: true, acceptNetworkPasses: true, networkPayoutRate: 300,
        offerDiscountedMemberships: false, discountPercentage: 50, maxDiscountedMembers: null,
        discountedMembersCount: 0, maxNetworkUsersPerDay: null, createdAt: NOW, updatedAt: NOW, lastUpdatedBy: null,
      } as never);
    });

    await ensurePartnerPerIncubatorMigration();
    const after1 = await db.read();
    const count1 = after1.partnerMemberships.length;
    const stamp1 = after1.meta?.partnerPerIncubatorMigratedAt;

    await ensurePartnerPerIncubatorMigration();
    const after2 = await db.read();

    expect(after2.partnerMemberships.length).toBe(count1);
    expect(after2.meta?.partnerPerIncubatorMigratedAt).toBe(stamp1); // unchanged
  });

  it('consolidates two legacy records for one incubator and re-points the second\'s promo codes', async () => {
    await db.update((d) => {
      d.incubators.push({ id: 'inc-2', name: 'Inc Two', status: 'ACTIVE' } as never);
      d.spaces.push(space('a', 'inc-2', 'COWORKING', { isPartnerInNetwork: true, partnerMembershipId: 'pm-a' }));
      d.spaces.push(space('b', 'inc-2', 'COWORKING', { isPartnerInNetwork: true, partnerMembershipId: 'pm-b' }));
      d.partnerMemberships.push(
        { id: 'pm-a', spaceId: 'a', isActive: true, acceptNetworkPasses: true, networkPayoutRate: 300, offerDiscountedMemberships: false, discountPercentage: 50, maxDiscountedMembers: null, discountedMembersCount: 0, maxNetworkUsersPerDay: null, createdAt: NOW, updatedAt: NOW, lastUpdatedBy: null } as never,
        { id: 'pm-b', spaceId: 'b', isActive: true, acceptNetworkPasses: true, networkPayoutRate: 300, offerDiscountedMemberships: false, discountPercentage: 50, maxDiscountedMembers: null, discountedMembersCount: 0, maxNetworkUsersPerDay: null, createdAt: NOW, updatedAt: NOW, lastUpdatedBy: null } as never,
      );
      d.partnerPromoCodes.push({ id: 'code-b', partnerId: 'pm-b', code: 'Y', isUsed: false } as never);
    });

    await ensurePartnerPerIncubatorMigration();
    const data = await db.read();

    const incubatorRecords = data.partnerMemberships.filter((p) => p.incubatorId === 'inc-2' && p.isActive);
    expect(incubatorRecords).toHaveLength(1);
    const canonical = incubatorRecords[0]!;
    expect(canonical.id).toBe('pm-a');

    const pmB = data.partnerMemberships.find((p) => p.id === 'pm-b')!;
    expect(pmB.isActive).toBe(false);                       // superseded, not deleted
    expect(pmB.supersededByIncubatorId).toBe('inc-2');

    const code = data.partnerPromoCodes.find((c) => c.id === 'code-b')!;
    expect(code.partnerId).toBe('pm-a');                    // re-pointed to canonical

    // Both spaces were enrolled → both bookable, both pointing at canonical.
    for (const id of ['a', 'b']) {
      const s = data.spaces.find((x) => x.id === id)!;
      expect(s.networkBookable).toBe(true);
      expect(s.partnerMembershipId).toBe('pm-a');
    }
  });
});

describe('enrollIncubator + per-space toggle', () => {
  beforeEach(reset);

  it('defaults coworking/training/domiciliation ON and private office OFF', async () => {
    await db.update((d) => {
      d.incubators.push({ id: 'inc-3', name: 'Inc Three', status: 'ACTIVE' } as never);
      d.spaces.push(space('s-cw', 'inc-3', 'COWORKING'));
      d.spaces.push(space('s-po', 'inc-3', 'PRIVATE_OFFICE'));
      d.spaces.push(space('s-tr', 'inc-3', 'TRAINING_ROOM'));
      d.spaces.push(space('s-dm', 'inc-3', 'DOMICILIATION'));
    });

    const partner = await enrollIncubator({ incubatorId: 'inc-3' }, ADMIN.id, ADMIN.email);
    expect(partner.incubatorId).toBe('inc-3');
    expect(partner.isActive).toBe(true);
    expect(partner.networkPayoutRate).toBe(300);

    const data = await db.read();
    const byId = (id: string) => data.spaces.find((s) => s.id === id)!;
    expect(byId('s-cw').networkBookable).toBe(true);
    expect(byId('s-cw').isPartnerInNetwork).toBe(true);
    expect(byId('s-tr').networkBookable).toBe(true);
    expect(byId('s-dm').networkBookable).toBe(true);
    expect(byId('s-po').networkBookable).toBe(false);
    expect(byId('s-po').isPartnerInNetwork).toBe(false);
  });

  it('setSpaceNetworkBookable toggles the booking-gate flag', async () => {
    await db.update((d) => {
      d.incubators.push({ id: 'inc-4', name: 'Inc Four', status: 'ACTIVE' } as never);
      d.spaces.push(space('x', 'inc-4', 'COWORKING'));
    });
    await enrollIncubator({ incubatorId: 'inc-4' }, ADMIN.id, ADMIN.email);

    const off = await setSpaceNetworkBookable('x', false, ADMIN.id, ADMIN.email);
    expect(off.networkBookable).toBe(false);
    expect(off.isPartnerInNetwork).toBe(false);

    const on = await setSpaceNetworkBookable('x', true, ADMIN.id, ADMIN.email);
    expect(on.networkBookable).toBe(true);
    expect(on.isPartnerInNetwork).toBe(true);

    const items = await listIncubatorPartners();
    const inc4 = items.find((i) => i.incubatorId === 'inc-4')!;
    expect(inc4.spaces.find((s) => s.id === 'x')!.networkBookable).toBe(true);
  });

  it('defaultNetworkBookable: private office off, others on', () => {
    expect(defaultNetworkBookable('PRIVATE_OFFICE')).toBe(false);
    expect(defaultNetworkBookable('COWORKING')).toBe(true);
    expect(defaultNetworkBookable('TRAINING_ROOM')).toBe(true);
    expect(defaultNetworkBookable('DOMICILIATION')).toBe(true);
  });
});
