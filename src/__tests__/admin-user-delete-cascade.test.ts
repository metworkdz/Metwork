/**
 * DELETE /api/admin/users/[id] — cascade completeness.
 *
 * The cascade originally covered only the original schema; collections added
 * later (desk bookings, withdrawal requests, network visits, partner
 * affiliations, perk vouchers, registrations) were orphaned on user
 * deletion — an orphaned desk booking even kept blocking availability.
 * This locks in full coverage plus the partner discounted-members decrement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'admin-1', email: 'a@x.com', role: 'ADMIN', approvalStatus: 'APPROVED' } });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

const USER_ID = 'u-cascade-1';
const OTHER_ID = 'u-keep-1';
const NOW = '2026-01-01T00:00:00.000Z';

function req(id: string) {
  return new NextRequest(`http://localhost/api/admin/users/${id}`, { method: 'DELETE' });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await db.update((d) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    d.users.push(
      { id: USER_ID, email: 'gone@x.com', fullName: 'Gone', role: 'ENTREPRENEUR', status: 'ACTIVE', passwordHash: 'x', phone: '', city: '', phoneVerified: true, emailVerified: true, membershipCode: null, avatarUrl: null, locale: 'fr', createdAt: NOW, updatedAt: NOW } as any,
      { id: OTHER_ID, email: 'keep@x.com', fullName: 'Keep', role: 'ENTREPRENEUR', status: 'ACTIVE', passwordHash: 'x', phone: '', city: '', phoneVerified: true, emailVerified: true, membershipCode: null, avatarUrl: null, locale: 'fr', createdAt: NOW, updatedAt: NOW } as any,
    );
    d.deskBookings = [
      { id: 'db-1', userId: USER_ID, spaceId: 's-1', deskName: 'A1', date: '2026-02-01', createdAt: NOW } as any,
      { id: 'db-null', userId: null, spaceId: 's-1', deskName: 'A2', date: '2026-02-01', createdAt: NOW } as any,
    ];
    d.withdrawalRequests = [
      { id: 'wr-1', userId: USER_ID, amount: 1000, status: 'PENDING', createdAt: NOW, updatedAt: NOW } as any,
      { id: 'wr-keep', userId: OTHER_ID, amount: 1000, status: 'PENDING', createdAt: NOW, updatedAt: NOW } as any,
    ];
    d.networkVisits = [{ id: 'nv-1', userId: USER_ID, spaceId: 's-1', createdAt: NOW, updatedAt: NOW } as any];
    d.perkVouchers = [{ id: 'pv-1', userId: USER_ID, perkId: 'perk-1', createdAt: NOW } as any];
    d.registrations = [
      { id: 'reg-1', userId: USER_ID, createdAt: NOW } as any,
      { id: 'reg-null', userId: null, createdAt: NOW } as any,
    ];
    d.partnerMemberships = [
      { id: 'partner-1', discountedMembersCount: 2 } as any,
    ];
    d.userPartnerAffiliations = [
      { id: 'aff-1', userId: USER_ID, partnerId: 'partner-1', referredAt: NOW, promoCodeUsed: 'hash' } as any,
      { id: 'aff-keep', userId: OTHER_ID, partnerId: 'partner-1', referredAt: NOW, promoCodeUsed: 'hash2' } as any,
    ];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});

describe('DELETE /api/admin/users/[id] cascade', () => {
  it('removes every collection the user owns and keeps other/null-owned rows', async () => {
    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    const res = await DELETE(req(USER_ID), ctx(USER_ID));
    expect(res.status).toBe(204);

    const d = await db.read();
    expect(d.users.find((u) => u.id === USER_ID)).toBeUndefined();
    expect((d.deskBookings ?? []).map((b) => b.id)).toEqual(['db-null']);
    expect((d.withdrawalRequests ?? []).map((w) => w.id)).toEqual(['wr-keep']);
    expect(d.networkVisits ?? []).toHaveLength(0);
    expect(d.perkVouchers ?? []).toHaveLength(0);
    expect((d.registrations ?? []).map((r) => r.id)).toEqual(['reg-null']);
    expect((d.userPartnerAffiliations ?? []).map((a) => a.id)).toEqual(['aff-keep']);
  });

  it('decrements the partner discounted-members count (never below zero)', async () => {
    const { DELETE } = await import('@/app/api/admin/users/[id]/route');
    await DELETE(req(USER_ID), ctx(USER_ID));

    const d = await db.read();
    const partner = (d.partnerMemberships ?? []).find((p) => p.id === 'partner-1');
    expect(partner?.discountedMembersCount).toBe(1);
  });
});
