/**
 * Integration tests for the unified promo-code system.
 *
 * Covers:
 *   - Regular promo lookup + usage counter
 *   - Partner promo lookup (hashed)
 *   - Invalid / expired / inactive paths
 *   - Usage-limit enforcement
 *   - One-time-use enforcement (partner)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { db } from '@/server/db/store';
import { lookupAnyPromoCode } from '@/server/promo-codes/lookup';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function seedRegular(overrides: Record<string, unknown> = {}): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) d.promoCodes = [];
    d.promoCodes.push({
      id: 'pc-1',
      code: 'WELCOME50',
      discountPercent: 50,
      appliesTo: 'ALL',
      expiresAt: '2030-01-01T00:00:00.000Z',
      usageLimit: 100,
      usedCount: 0,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });
}

async function seedPartner(overrides: Record<string, unknown> = {}): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.partnerMemberships)) d.partnerMemberships = [];
    if (!Array.isArray(d.partnerPromoCodes))  d.partnerPromoCodes  = [];
    if (!d.partnerMemberships.find((p) => p.id === 'partner-1')) {
      d.partnerMemberships.push({
        id: 'partner-1',
        partnerName: 'Test Partner',
        isActive: true,
        // Cast — the test only needs a partial record for the active check.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
    d.partnerPromoCodes.push({
      id: 'ppc-1',
      code: sha256('PARTNER25'),
      partnerId: 'partner-1',
      batchId: 'batch-1',
      discountPercentage: 25,
      membershipTier: 'BUILDER',
      validFrom: '2026-01-01',
      validUntil: '2030-01-01',
      isUsed: false,
      usedBy: null,
      usedAt: null,
      usedForMembership: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdFor: null,
      ...overrides,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });
}

describe('lookupAnyPromoCode — regular codes', () => {
  it('returns kind=REGULAR with the discount percent on a valid code', async () => {
    await seedRegular();
    const result = await lookupAnyPromoCode('WELCOME50');
    expect(result.kind).toBe('REGULAR');
    if (result.kind === 'REGULAR') {
      expect(result.code).toBe('WELCOME50');
      expect(result.discountPercent).toBe(50);
      expect(result.appliesTo).toBe('ALL');
    }
  });

  it('is case-insensitive on input', async () => {
    await seedRegular();
    const result = await lookupAnyPromoCode('welcome50');
    expect(result.kind).toBe('REGULAR');
  });

  it('rejects an expired code', async () => {
    await seedRegular({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const result = await lookupAnyPromoCode('WELCOME50');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('EXPIRED');
  });

  it('rejects an inactive code', async () => {
    await seedRegular({ isActive: false });
    const result = await lookupAnyPromoCode('WELCOME50');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('INACTIVE');
  });

  it('rejects a code that has reached its usage limit', async () => {
    await seedRegular({ usageLimit: 10, usedCount: 10 });
    const result = await lookupAnyPromoCode('WELCOME50');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('LIMIT_REACHED');
  });

  it('returns NOT_FOUND for an unknown code', async () => {
    const result = await lookupAnyPromoCode('DOES-NOT-EXIST');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('NOT_FOUND');
  });
});

describe('lookupAnyPromoCode — partner codes', () => {
  it('matches a partner code by hash and returns kind=PARTNER', async () => {
    await seedPartner();
    const result = await lookupAnyPromoCode('PARTNER25');
    expect(result.kind).toBe('PARTNER');
    if (result.kind === 'PARTNER') {
      expect(result.discountPercent).toBe(25);
      expect(result.membershipTier).toBe('BUILDER');
      expect(result.partnerId).toBe('partner-1');
    }
  });

  it('rejects a partner code that has already been used', async () => {
    await seedPartner({ isUsed: true, usedBy: 'user-x', usedAt: '2026-01-02T00:00:00.000Z' });
    const result = await lookupAnyPromoCode('PARTNER25');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('ALREADY_USED');
  });

  it('rejects a partner code when the partner is inactive', async () => {
    await seedPartner();
    await db.update((d) => {
      const p = d.partnerMemberships.find((p) => p.id === 'partner-1')!;
      p.isActive = false;
    });
    const result = await lookupAnyPromoCode('PARTNER25');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('PARTNER_INACTIVE');
  });

  it('rejects a partner code after its validUntil date', async () => {
    await seedPartner({ validUntil: '2020-01-01' });
    const result = await lookupAnyPromoCode('PARTNER25');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('EXPIRED');
  });

  it('regular code is preferred when both systems would match', async () => {
    // Pathological case: same plaintext code seeded in both systems.
    // Regular check runs first, so it wins.
    await seedRegular({ code: 'COLLIDE' });
    await seedPartner({ code: sha256('COLLIDE') });
    const result = await lookupAnyPromoCode('COLLIDE');
    expect(result.kind).toBe('REGULAR');
  });
});

describe('lookupAnyPromoCode — input validation', () => {
  it('rejects empty input', async () => {
    const result = await lookupAnyPromoCode('');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('INVALID_FORMAT');
  });

  it('rejects whitespace-only input', async () => {
    const result = await lookupAnyPromoCode('   ');
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.reason).toBe('INVALID_FORMAT');
  });
});
