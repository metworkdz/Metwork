/**
 * Canonical consultation pricing helpers — the ONE read path shared by the
 * public mentor profile and both booking dialogs. Locks the "hourly rate"
 * model (Option A): `consultationFee` is the single source of truth, a mentor
 * with no positive fee is *unpriced* (not "free"), and the paid duration menu
 * no longer offers a 30-minute session.
 */
import { describe, it, expect } from 'vitest';
import { DURATION_OPTIONS, computePrice, resolveMentorPricing } from '@/lib/consultation-pricing';

describe('DURATION_OPTIONS', () => {
  it('no longer offers a 30-minute paid session and starts at 60 min', () => {
    expect(DURATION_OPTIONS.some((o) => o.value === 30)).toBe(false);
    expect(DURATION_OPTIONS[0]!.value).toBe(60);
  });
});

describe('computePrice', () => {
  it('pro-rates the hourly rate by duration', () => {
    expect(computePrice(10_000, 60)).toBe(10_000);
    expect(computePrice(10_000, 90)).toBe(15_000);
    expect(computePrice(0, 60)).toBe(0);
  });
});

describe('resolveMentorPricing', () => {
  it('treats a positive fee as priced', () => {
    expect(resolveMentorPricing({ consultationFee: 8000 })).toEqual({
      feePerHour: 8000,
      isPriced: true,
      freeIntro: false,
    });
  });

  it('treats a missing or zero fee as UNPRICED (not free)', () => {
    expect(resolveMentorPricing({})).toEqual({ feePerHour: 0, isPriced: false, freeIntro: false });
    expect(resolveMentorPricing({ consultationFee: 0 })).toEqual({ feePerHour: 0, isPriced: false, freeIntro: false });
  });

  it('surfaces the free intro flag independently of the hourly rate', () => {
    expect(resolveMentorPricing({ consultationFee: 5000, freeIntroEnabled: true })).toEqual({
      feePerHour: 5000,
      isPriced: true,
      freeIntro: true,
    });
    // Unpriced but offers a free intro — both facts are true at once.
    expect(resolveMentorPricing({ freeIntroEnabled: true })).toEqual({
      feePerHour: 0,
      isPriced: false,
      freeIntro: true,
    });
  });
});
