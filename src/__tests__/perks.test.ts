/**
 * Partner Perks service tests — tier gating (both membership vocabularies),
 * CODE_POOL claim lifecycle (duplicate reject, out-of-stock, low-stock
 * one-shot stamp + restock re-arm) and VOUCHER live-validity + supersede.
 */
import { describe, it, expect } from 'vitest';
import { db } from '@/server/db/store';
import {
  createPerk,
  updatePerk,
  addPoolCodes,
  listPoolEntries,
  listPerks,
  listPerksForUser,
  claimPerk,
  verifyVoucher,
  meetsMinTier,
} from '@/server/perks/service';
import type { UserRecord } from '@/server/db/store';

async function seedUser(partial: Partial<UserRecord>): Promise<UserRecord> {
  const now = new Date().toISOString();
  const user = {
    id: `u_${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@t.test`,
    passwordHash: 'x',
    fullName: 'Ahmed Benali',
    phone: '+213000000000',
    city: 'Algiers',
    role: 'ENTREPRENEUR',
    status: 'ACTIVE',
    phoneVerified: true,
    emailVerified: true,
    membershipCode: null,
    avatarUrl: null,
    locale: 'en',
    createdAt: now,
    updatedAt: now,
    ...partial,
  } as UserRecord;
  await db.update((d) => {
    d.users.push(user);
  });
  return user;
}

describe('perks smoke', () => {
  it('tier gate maps both vocabularies', () => {
    expect(meetsMinTier({ membershipCode: 'ENTREPRENEUR' }, 'BUILDER')).toBe(true);
    expect(meetsMinTier({ membershipCode: 'ENTREPRENEUR' }, 'FOUNDER')).toBe(false);
    expect(meetsMinTier({ membershipCode: 'STARTUP' }, 'FOUNDER')).toBe(true);
    expect(meetsMinTier({ membershipCode: null, membershipTier: 'BUILDER' }, 'BUILDER')).toBe(true);
    expect(meetsMinTier({ membershipCode: null }, 'BUILDER')).toBe(false);
    // expired membership → FREE
    expect(
      meetsMinTier(
        { membershipCode: 'STARTUP', membershipExpiresAt: '2020-01-01T00:00:00Z' },
        'BUILDER',
      ),
    ).toBe(false);
  });

  it('CODE_POOL: claim, duplicate reject, out-of-stock, low-stock stamp, restock re-arm', async () => {
    const builder = await seedUser({ membershipTier: 'BUILDER', fullName: 'Ahmed Benali' });
    const builder2 = await seedUser({ membershipTier: 'BUILDER' });
    const free = await seedUser({});

    const perk = await createPerk({
      partnerName: 'SlickPay',
      logoUrl: null,
      title: '3 months free',
      description: 'desc',
      fulfillmentType: 'CODE_POOL',
      minTier: 'BUILDER',
      lowStockThreshold: 2,
      active: true,
    });

    const addRes = await addPoolCodes(perk.id, 'SP-AAA\nSP-BBB\n\nSP-AAA\n');
    expect(addRes).toEqual({ added: 2, skippedDuplicates: 1 });

    // Tier enforcement server-side
    const freeClaim = await claimPerk(free.id, perk.id);
    expect(freeClaim).toEqual({ ok: false, reason: 'TIER_TOO_LOW' });

    // Happy path — crosses below threshold (1 < 2) → lowStock payload + stamp
    const c1 = await claimPerk(builder.id, perk.id);
    expect(c1.ok).toBe(true);
    if (c1.ok && c1.kind === 'CODE_POOL') {
      expect(c1.code).toBe('SP-AAA');
      expect(c1.lowStock).toMatchObject({ remaining: 1, threshold: 2 });
    }

    // Duplicate claim → hard reject
    const dup = await claimPerk(builder.id, perk.id);
    expect(dup).toEqual({ ok: false, reason: 'ALREADY_CLAIMED' });

    // Second user drains pool — lowStockNotifiedAt already set → NO second payload
    const c2 = await claimPerk(builder2.id, perk.id);
    expect(c2.ok).toBe(true);
    if (c2.ok && c2.kind === 'CODE_POOL') expect(c2.lowStock).toBeNull();

    // Out of stock
    const b3 = await seedUser({ membershipTier: 'FOUNDER' });
    const c3 = await claimPerk(b3.id, perk.id);
    expect(c3).toEqual({ ok: false, reason: 'OUT_OF_STOCK' });

    // Restock clears the stamp
    await addPoolCodes(perk.id, 'SP-CCC');
    const perks = await listPerks();
    const reread = perks.find((p) => p.id === perk.id)!;
    expect(reread.lowStockNotifiedAt).toBeNull();
    expect(reread.stockAvailable).toBe(1);
    expect(reread.codesAssigned).toBe(2);

    // Reconciliation listing shows assignee
    const pool = await listPoolEntries(perk.id);
    const assigned = pool!.find((e) => e.code === 'SP-AAA')!;
    expect(assigned.assignedToUserId).toBe(builder.id);
    expect(assigned.assignedToEmail).toBe(builder.email);

    // user listing shows claimed + code
    const mine = await listPerksForUser({ ...builder });
    const view = mine.find((p) => p.id === perk.id)!;
    expect(view.claimStatus).toBe('claimed');
    expect(view.claim?.code).toBe('SP-AAA');
  });

  it('VOUCHER: claim, verify ACTIVE, lapse → EXPIRED, re-claim supersedes', async () => {
    const founder = await seedUser({ membershipCode: 'STARTUP', fullName: 'Yacine Ould Kaci' });

    const perk = await createPerk({
      partnerName: 'Hotel El Aurassi',
      logoUrl: 'https://x.test/logo.png',
      title: '20% off stays',
      description: 'desc',
      fulfillmentType: 'VOUCHER',
      minTier: 'FOUNDER',
      lowStockThreshold: null,
      active: true,
    });

    const c1 = await claimPerk(founder.id, perk.id);
    expect(c1.ok).toBe(true);
    const code1 = c1.ok && c1.kind === 'VOUCHER' ? c1.code : '';
    expect(code1).toMatch(/^MTW-[A-Z0-9]{6}$/);

    // Verify → ACTIVE, privacy-reduced name
    const v1 = await verifyVoucher(code1);
    expect(v1).toMatchObject({
      status: 'ACTIVE',
      replaced: false,
      holderName: 'Yacine K.',
      tier: 'FOUNDER',
      partnerName: 'Hotel El Aurassi',
    });

    // Unknown code → null (route returns generic 404)
    expect(await verifyVoucher('MTW-ZZZZZZ')).toBeNull();

    // Membership lapses → live status flips to EXPIRED (nothing stored)
    await db.update((d) => {
      const u = d.users.find((x) => x.id === founder.id)!;
      u.membershipExpiresAt = '2020-01-01T00:00:00Z';
    });
    expect((await verifyVoucher(code1))?.status).toBe('EXPIRED');

    // Renewal → same voucher live again; re-claim supersedes & issues fresh
    await db.update((d) => {
      const u = d.users.find((x) => x.id === founder.id)!;
      u.membershipExpiresAt = null;
    });
    const c2 = await claimPerk(founder.id, perk.id);
    expect(c2.ok).toBe(true);
    const code2 = c2.ok && c2.kind === 'VOUCHER' ? c2.code : '';
    expect(code2).not.toBe(code1);

    const old = await verifyVoucher(code1);
    expect(old).toMatchObject({ status: 'EXPIRED', replaced: true });
    expect((await verifyVoucher(code2))?.status).toBe('ACTIVE');

    // Inactive perk rejects claims
    await updatePerk(perk.id, { active: false });
    const c3 = await claimPerk(founder.id, perk.id);
    expect(c3).toEqual({ ok: false, reason: 'PERK_INACTIVE' });
  });
});
