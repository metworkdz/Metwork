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
import { db } from '@/server/db/store';
import {
  getEffectiveMembershipCode,
  getSpaceDiscountForUser,
  getConsultationDiscountForUser,
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

describe('discount maps', () => {
  it('SPACE_DISCOUNT and CONSULTATION_DISCOUNT cover all four code/tier keys', () => {
    for (const map of [SPACE_DISCOUNT, CONSULTATION_DISCOUNT]) {
      expect(map.ENTREPRENEUR).toBe(0.15);
      expect(map.BUILDER).toBe(0.15);
      expect(map.STARTUP).toBe(0.2);
      expect(map.FOUNDER).toBe(0.2);
    }
  });
});

describe('per-user discount resolution', () => {
  it('partner-promo user with legacy lowercase code gets space + consultation discounts', async () => {
    const id = await seedUser({
      membershipCode: 'builder',
      membershipTier: 'BUILDER',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
    expect(await getConsultationDiscountForUser(id)).toBe(0.15);
  });

  it('tier-only FOUNDER user gets 20 % on spaces and consultations', async () => {
    const id = await seedUser({
      membershipCode: null,
      membershipTier: 'FOUNDER',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.2);
    expect(await getConsultationDiscountForUser(id)).toBe(0.2);
  });

  it('expired membership gets no discount', async () => {
    const id = await seedUser({
      membershipCode: 'STARTUP',
      membershipExpiresAt: PAST,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0);
    expect(await getConsultationDiscountForUser(id)).toBe(0);
  });

  it('purchased ENTREPRENEUR member is unchanged (15 %)', async () => {
    const id = await seedUser({
      membershipCode: 'ENTREPRENEUR',
      membershipExpiresAt: FUTURE,
    });
    expect(await getSpaceDiscountForUser(id)).toBe(0.15);
  });
});
