/**
 * Regression tests for the membership tier → discount pipeline.
 *
 * Guards the two historical failure modes:
 *   - partner-promo redemptions wrote membershipCode in lowercase
 *     ('builder'/'founder'), which every uppercase-keyed discount map missed;
 *   - the space-discount table lacked the BUILDER/FOUNDER keys its
 *     consultation counterpart already had, so tier-keyed users got 0 % on
 *     spaces/events even with correct casing.
 *
 * Both maps are gone: every rate now resolves through `resolveMemberBenefits`.
 * The cases below therefore assert the BEHAVIOUR those bugs broke — all four
 * code/tier spellings resolving to a real rate — rather than the shape of a
 * constant, which is what let the two tables drift apart in the first place.
 */
import { describe, it, expect } from 'vitest';
import { db, type UserMembershipRecord } from '@/server/db/store';
import {
  getEffectiveMembershipCode,
  getSpaceDiscountForUser,
  getConsultationDiscountForUser,
  getMemberBenefits,
  getMonthlyPassCountForUser,
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

describe('all four code/tier spellings resolve to a real rate', () => {
  // The original regression, restated against the resolver: a user carrying
  // ENTREPRENEUR, BUILDER, STARTUP or FOUNDER must never silently fall through
  // to 0 % just because of which field or casing their record happens to use.
  it.each([
    ['ENTREPRENEUR', 'ENTREPRENEUR', null],
    ['BUILDER',      null,           'BUILDER'],
    ['STARTUP',      'STARTUP',      null],
    ['FOUNDER',      null,           'FOUNDER'],
  ])('%s resolves to the live plan config', async (_label, code, tier) => {
    const id = await seedUser({
      membershipCode: code,
      membershipTier: tier,
      membershipExpiresAt: FUTURE,
    });
    const benefits = await getMemberBenefits(id);
    expect(benefits.source).toBe('config');
    expect(benefits.spaceDiscountRate).toBeGreaterThan(0);
    expect(benefits.consultationDiscountRate).toBeGreaterThan(0);
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
  // through to the live plan config. The two plans agree on spaces (15 %) and
  // DIVERGE on consultations — Entrepreneur 10 %, Startup 20 % — which is the
  // point of these two cases.
  it('partner-promo Entrepreneur with legacy lowercase code resolves to current terms', async () => {
    const id = await seedUser({
      membershipCode: 'builder',
      membershipTier: 'BUILDER',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
    expect(await getConsultationDiscountForUser(id)).toBe(0.10);
  });

  it('tier-only Startup (FOUNDER) user gets the higher consultation rate', async () => {
    const id = await seedUser({
      membershipCode: null,
      membershipTier: 'FOUNDER',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
    expect(await getConsultationDiscountForUser(id)).toBe(0.20);
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
