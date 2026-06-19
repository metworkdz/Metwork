/**
 * Security regression tests for Network-Pass check-in (P1-1 / P2-1).
 *
 *  - authorizeSpaceCheckIn: only the partner space's owning incubator (or an
 *    ADMIN) may scan/commit; a random member is rejected.
 *  - recordCheckIn: re-validates the code at commit time (expired / wrong-date
 *    bookings are refused even if a code row exists) — the validate() pipeline
 *    can no longer be bypassed by calling record directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { authorizeSpaceCheckIn, recordCheckIn } from '@/server/network/checkin-service';
import { hashCode } from '@/server/network/qr-utils';

const NOW = '2026-06-01T10:00:00.000Z';
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function seedCommon(d: Record<string, unknown[]>): void {
  d.incubators = [
    { id: 'inc-1', name: 'Owner Inc', email: 'owner@inc.com', managerId: 'mgr-1', status: 'ACTIVE' } as never,
  ];
  d.spaces = [
    { id: 'space-1', incubatorId: 'inc-1', isActive: true, partnerMembershipId: 'pm-1', isPartnerInNetwork: true, name: 'Desk' } as never,
  ];
  d.partnerMemberships = [
    { id: 'pm-1', spaceId: 'space-1', networkPayoutRate: 300, isActive: true, acceptNetworkPasses: true } as never,
  ];
  d.users = [
    { id: 'mgr-1', email: 'owner@inc.com', role: 'INCUBATOR', fullName: 'Owner', status: 'ACTIVE' } as never,
    { id: 'member-1', email: 'm@x.com', role: 'ENTREPRENEUR', fullName: 'Member', status: 'ACTIVE' } as never,
    { id: 'attacker-1', email: 'a@x.com', role: 'ENTREPRENEUR', fullName: 'Attacker', status: 'ACTIVE' } as never,
  ];
}

describe('authorizeSpaceCheckIn', () => {
  beforeEach(async () => {
    await db.update((d) => seedCommon(d as never));
  });

  it('allows the owning incubator manager', async () => {
    const ok = await authorizeSpaceCheckIn({ id: 'mgr-1', email: 'owner@inc.com', role: 'INCUBATOR' }, 'space-1');
    expect(ok).toBe(true);
  });

  it('allows a platform admin', async () => {
    const ok = await authorizeSpaceCheckIn({ id: 'admin-1', email: 'admin@x.com', role: 'ADMIN' }, 'space-1');
    expect(ok).toBe(true);
  });

  it('rejects a random authenticated member', async () => {
    const ok = await authorizeSpaceCheckIn({ id: 'attacker-1', email: 'a@x.com', role: 'ENTREPRENEUR' }, 'space-1');
    expect(ok).toBe(false);
  });

  it('rejects an incubator that does not own the space', async () => {
    await db.update((d) => {
      (d.incubators as unknown[]).push({ id: 'inc-2', email: 'other@inc.com', managerId: 'mgr-2', status: 'ACTIVE' } as never);
    });
    const ok = await authorizeSpaceCheckIn({ id: 'mgr-2', email: 'other@inc.com', role: 'INCUBATOR' }, 'space-1');
    expect(ok).toBe(false);
  });
});

describe('recordCheckIn — commit-time re-validation', () => {
  function seedCode(opts: { bookingDate: string; expiresAt: string; status?: string }): Promise<unknown> {
    return db.update((d) => {
      seedCommon(d as never);
      d.bookings = [
        {
          id: 'bk-1', userId: 'member-1', itemKind: 'SPACE', itemId: 'space-1',
          paymentMethod: 'NETWORK_PASS', status: opts.status ?? 'CONFIRMED',
          startsAt: `${opts.bookingDate}T09:00:00.000Z`, endsAt: `${opts.bookingDate}T11:00:00.000Z`,
          clientReference: 'r1', createdAt: NOW, updatedAt: NOW,
        } as never,
      ];
      d.networkCheckInCodes = [
        {
          id: 'code-1', bookingId: 'bk-1', spaceId: 'space-1', userId: 'member-1',
          codeHash: hashCode('MNP-2026-00001'), expiresAt: opts.expiresAt,
          sequenceNumber: 1, consumed: false, consumedAt: null, visitId: null, createdAt: NOW,
        } as never,
      ];
      d.networkVisits = [];
    });
  }

  it('records a valid, today, unexpired code', async () => {
    await seedCode({ bookingDate: TODAY, expiresAt: `${TODAY}T23:59:59.999Z` });
    const res = await recordCheckIn('visit-1', 'space-1', 'member-1', 'MANUAL', 'mgr-1');
    expect(res.success).toBe(true);
    const data = await db.read();
    expect((data.networkVisits ?? []).length).toBe(1);
    expect(data.networkCheckInCodes![0]!.consumed).toBe(true);
  });

  it('refuses an expired code', async () => {
    await seedCode({ bookingDate: TODAY, expiresAt: '2020-01-01T00:00:00.000Z' });
    const res = await recordCheckIn('visit-2', 'space-1', 'member-1', 'MANUAL', 'mgr-1');
    expect(res.success).toBe(false);
    const data = await db.read();
    expect((data.networkVisits ?? []).length).toBe(0);
  });

  it("refuses a booking that is not for today (stale-code bypass)", async () => {
    await seedCode({ bookingDate: YESTERDAY, expiresAt: `${TODAY}T23:59:59.999Z` });
    const res = await recordCheckIn('visit-3', 'space-1', 'member-1', 'MANUAL', 'mgr-1');
    expect(res.success).toBe(false);
  });
});
