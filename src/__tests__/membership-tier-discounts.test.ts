/**
 * Regression tests for the membership tier → discount pipeline.
 *
 * Guards the two historical failure modes:
 *   - partner-promo redemptions wrote membershipCode in lowercase
 *     ('builder'/'founder'), which every uppercase-keyed discount map missed;
 *   - SPACE_DISCOUNT lacked the BUILDER/FOUNDER keys that
 *     CONSULTATION_DISCOUNT already had, so tier-keyed users got 0 % on
 *     spaces/events even with correct casing.
 */
import { describe, it, expect } from 'vitest';
import { db, type UserMembershipRecord } from '@/server/db/store';
import {
  getEffectiveMembershipCode,
  getSpaceDiscountForUser,
  getConsultationDiscountForUser,
  getMemberBenefits,
  getMonthlyPassCountForUser,
  SPACE_DISCOUNT,
  CONSULTATION_DISCOUNT,
} from '@/server/memberships/service';

const FUTURE = '2030-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

async function seedUser(overrides: Record<string, unknown>): Promise<string> {
  const id = `u-${Math.random().toString(36).slice(2, 10)}`;
  await db.update((d) => {
    d.users.push({
      id,
      email: `${id}@test.dz`,
      fullName: 'Tier Test',
      phone: '+213550000000',
      city: 'Algiers',
      role: 'ENTREPRENEUR',
      status: 'ACTIVE',
      passwordHash: 'x',
      phoneVerified: true,
      emailVerified: true,
      membershipCode: null,
      avatarUrl: null,
      locale: 'fr',
      createdAt: PAST,
      updatedAt: PAST,
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });
  return id;
}

describe('getEffectiveMembershipCode', () => {
  it('returns canonical uppercase codes unchanged', () => {
    expect(getEffectiveMembershipCode({ membershipCode: 'ENTREPRENEUR', membershipExpiresAt: FUTURE })).toBe('ENTREPRENEUR');
    expect(getEffectiveMembershipCode({ membershipCode: 'STARTUP', membershipExpiresAt: FUTURE })).toBe('STARTUP');
  });

  it('normalizes lowercase partner-promo codes to the canonical tier', () => {
    expect(getEffectiveMembershipCode({ membershipCode: 'builder', membershipExpiresAt: FUTURE })).toBe('BUILDER');
    expect(getEffectiveMembershipCode({ membershipCode: 'founder', membershipExpiresAt: FUTURE })).toBe('FOUNDER');
  });

  it('returns FREE once expired, regardless of code casing', () => {
    expect(getEffectiveMembershipCode({ membershipCode: 'builder', membershipExpiresAt: PAST })).toBe('FREE');
    expect(getEffectiveMembershipCode({ membershipCode: 'STARTUP', membershipExpiresAt: PAST })).toBe('FREE');
  });

  it('falls back to membershipTier when no code is set', () => {
    expect(getEffectiveMembershipCode({ membershipCode: null, membershipTier: 'BUILDER' })).toBe('BUILDER');
    expect(getEffectiveMembershipCode({ membershipCode: null, membershipTier: 'FOUNDER' })).toBe('FOUNDER');
    expect(getEffectiveMembershipCode({ membershipCode: null, membershipTier: 'EXPLORER' })).toBe('FREE');
  });

  it('prefers a recognized tier over an unrecognized code', () => {
    expect(
      getEffectiveMembershipCode({ membershipCode: 'legacy-plan-x', membershipTier: 'FOUNDER' }),
    ).toBe('FOUNDER');
  });

  it('keeps an unrecognized code verbatim when no tier is set (legacy behavior)', () => {
    expect(getEffectiveMembershipCode({ membershipCode: 'legacy-plan-x' })).toBe('legacy-plan-x');
  });
});

describe('legacy discount maps', () => {
  // These maps are no longer the live rate — they record the PRE-repricing
  // terms that grandfathered members are still entitled to. The four-key
  // coverage is the original regression: a missing BUILDER/FOUNDER key silently
  // gave tier-keyed users 0 %.
  it('SPACE_DISCOUNT and CONSULTATION_DISCOUNT cover all four code/tier keys', () => {
    for (const map of [SPACE_DISCOUNT, CONSULTATION_DISCOUNT]) {
      expect(map.ENTREPRENEUR).toBe(0.15);
      expect(map.BUILDER).toBe(0.15);
      expect(map.STARTUP).toBe(0.2);
      expect(map.FOUNDER).toBe(0.2);
    }
  });
});

async function seedMembership(
  userId: string,
  plan: string,
  snapshot: Partial<UserMembershipRecord> = {},
): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.userMemberships)) d.userMemberships = [];
    d.userMemberships.push({
      id: `m-${Math.random().toString(36).slice(2, 10)}`,
      userId,
      plan,
      startsAt: PAST,
      expiresAt: FUTURE,
      status: 'ACTIVE',
      createdAt: PAST,
      updatedAt: PAST,
      ...snapshot,
    });
  });
}

describe('per-user discount resolution (no snapshot ⇒ live config)', () => {
  // Members with neither a frozen snapshot nor a user-record mirror fall
  // through to the live plan config: 10 % consultations / 15 % spaces on BOTH
  // tiers after the 2026-08 repricing.
  it('partner-promo user with legacy lowercase code resolves to current terms', async () => {
    const id = await seedUser({
      membershipCode: 'builder',
      membershipTier: 'BUILDER',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
    expect(await getConsultationDiscountForUser(id)).toBe(0.10);
  });

  it('tier-only FOUNDER user resolves to the unified current terms', async () => {
    const id = await seedUser({
      membershipCode: null,
      membershipTier: 'FOUNDER',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
    expect(await getConsultationDiscountForUser(id)).toBe(0.10);
  });

  it('expired membership gets no discount', async () => {
    const id = await seedUser({
      membershipCode: 'STARTUP',
      membershipExpiresAt: PAST,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0);
    expect(await getConsultationDiscountForUser(id)).toBe(0);
  });
});

describe('frozen snapshot wins over live config', () => {
  it('grandfathered FOUNDER keeps the 20 % / 20 % terms they bought', async () => {
    const id = await seedUser({
      membershipCode: 'STARTUP',
      membershipTier: 'FOUNDER',
      membershipExpiresAt: FUTURE,
    });
    await seedMembership(id, 'STARTUP', {
      spaceDiscountRate: 0.2,
      consultationDiscountRate: 0.2,
      monthlyPassCount: 10,
      snapshotAt: PAST,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.2);
    expect(await getConsultationDiscountForUser(id)).toBe(0.2);
    expect(await getMonthlyPassCountForUser(id)).toBe(10);

    const benefits = await getMemberBenefits(id);
    expect(benefits.source).toBe('snapshot');
  });

  it('a CANCELLED membership snapshot never wins', async () => {
    const id = await seedUser({
      membershipCode: 'ENTREPRENEUR',
      membershipTier: 'BUILDER',
      membershipExpiresAt: FUTURE,
    });
    await seedMembership(id, 'ENTREPRENEUR', {
      status: 'CANCELLED',
      spaceDiscountRate: 0.9,
      consultationDiscountRate: 0.9,
      snapshotAt: PAST,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
    expect(await getConsultationDiscountForUser(id)).toBe(0.10);
  });

  it('user-record mirror is used when no membership record exists', async () => {
    const id = await seedUser({
      membershipCode: 'ENTREPRENEUR',
      membershipTier: 'BUILDER',
      membershipExpiresAt: FUTURE,
      membershipSpaceDiscountRate: 0.25,
      membershipConsultationDiscountRate: 0.05,
    });
    const benefits = await getMemberBenefits(id);
    expect(benefits.source).toBe('user');
    expect(benefits.spaceDiscountRate).toBe(0.25);
    expect(benefits.consultationDiscountRate).toBe(0.05);
  });

  it('FREE users get nothing regardless of stray snapshots', async () => {
    const id = await seedUser({ membershipCode: null, membershipTier: 'EXPLORER' });
    await seedMembership(id, 'STARTUP', {
      spaceDiscountRate: 0.5,
      consultationDiscountRate: 0.5,
      snapshotAt: PAST,
    });
    const benefits = await getMemberBenefits(id);
    expect(benefits.code).toBe('FREE');
    expect(benefits.source).toBe('none');
    expect(benefits.spaceDiscountRate).toBe(0);
    expect(benefits.consultationDiscountRate).toBe(0);
    expect(benefits.monthlyPassCount).toBe(0);
  });
});
