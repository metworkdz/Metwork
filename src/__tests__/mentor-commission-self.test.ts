/**
 * Tests for the tiered consultant commission (2026-07-06):
 *
 *   • Self-signed-up consultants (MentorRecord.source === 'SELF') resolve
 *     against the MENTOR_CONSULTATION_SELF rule — default 20 % platform /
 *     80 % consultant — admin-configurable like every other rule.
 *   • Everyone else (admin-added / legacy, source absent) keeps the standard
 *     MENTOR_CONSULTATION rule (30/70 default) — behaviour is UNCHANGED.
 *   • `creditPendingEarning` resolves the mentor's source from the store, so
 *     settlement writes the tier-correct split into the ledger.
 */
import { describe, it, expect } from 'vitest';
import { db, type CommissionRuleRecord, type MentorRecord } from '@/server/db/store';
import {
  computeMentorPromoSplit,
  resolveMentorCommissionRates,
  DEFAULT_SELF_CONSULTANT_PLATFORM_RATE,
  MENTOR_CONSULTATION_SELF_RULE_TYPE,
} from '@/server/payments/mentor-commission';
import { creditPendingEarning } from '@/server/mentors/ledger';

function rule(transactionType: string, rate: number, isActive = true): CommissionRuleRecord {
  return {
    id: `rule_${transactionType.toLowerCase()}`,
    name: transactionType,
    transactionType,
    rate,
    description: 'test',
    isActive,
    updatedAt: new Date(0).toISOString(),
  };
}

function mentorRecord(id: string, source?: 'ADMIN' | 'SELF'): MentorRecord {
  return {
    id,
    fullName: `Mentor ${id}`,
    position: 'Consultant',
    imageUrl: '/assets/profilelogogreen.png',
    bio: null,
    linkedinUrl: null,
    email: `${id}@test.dz`,
    consultationFee: 4000,
    createdAt: new Date(0).toISOString(),
    ...(source ? { source } : {}),
  } as MentorRecord;
}

describe('resolveMentorCommissionRates — source tiers', () => {
  it('defaults SELF consultants to 20% platform / 80% consultant', () => {
    expect(DEFAULT_SELF_CONSULTANT_PLATFORM_RATE).toBe(0.2);
    const { platformRate, mentorRate } = resolveMentorCommissionRates([], { source: 'SELF' });
    expect(platformRate).toBe(0.2);
    expect(mentorRate).toBeCloseTo(0.8, 10);
  });

  it('keeps the legacy 30/70 default for admin-added / legacy mentors', () => {
    for (const context of [undefined, null, {}, { source: 'ADMIN' as const }, { source: null }]) {
      const { platformRate } = resolveMentorCommissionRates([], context);
      expect(platformRate).toBe(0.3);
    }
  });

  it('prefers an active admin-configured MENTOR_CONSULTATION_SELF rule', () => {
    const rules = [
      rule('MENTOR_CONSULTATION', 0.35),
      rule(MENTOR_CONSULTATION_SELF_RULE_TYPE, 0.15),
    ];
    expect(resolveMentorCommissionRates(rules, { source: 'SELF' }).platformRate).toBe(0.15);
    // Standard mentors are untouched by the SELF rule.
    expect(resolveMentorCommissionRates(rules).platformRate).toBe(0.35);
  });

  it('falls back to the 20% SELF default when the SELF rule is inactive', () => {
    const rules = [rule(MENTOR_CONSULTATION_SELF_RULE_TYPE, 0.5, false)];
    expect(resolveMentorCommissionRates(rules, { source: 'SELF' }).platformRate).toBe(0.2);
  });

  it('computeMentorPromoSplit pays a SELF consultant 80% of the base price', () => {
    const split = computeMentorPromoSplit(
      { basePrice: 4000, collectedAmount: 4000 },
      [],
      { source: 'SELF' },
    );
    expect(split.consultantShare).toBe(3200); // 80% of base
    expect(split.platformShare).toBe(800);
  });
});

describe('creditPendingEarning — tier resolved from the mentor record', () => {
  it('credits a SELF consultant at the 20% rate', async () => {
    await db.update((d) => {
      if (!Array.isArray(d.mentors)) d.mentors = [];
      d.mentors.push(mentorRecord('mentor-self-rate', 'SELF'));
      d.commissionRules = [];
    });
    const res = await creditPendingEarning({
      mentorId: 'mentor-self-rate',
      bookingId: 'bk-self-rate-1',
      grossAmount: 4000,
    });
    expect(res.replayed).toBe(false);
    expect(res.split.mentorNet).toBe(3200); // 80%
    expect(res.split.platformCommission).toBe(800);
    expect(res.split.platformRate).toBe(0.2);
  });

  it('keeps the legacy 30/70 split for a mentor without a source field', async () => {
    await db.update((d) => {
      if (!Array.isArray(d.mentors)) d.mentors = [];
      d.mentors.push(mentorRecord('mentor-legacy-rate'));
      d.commissionRules = [];
    });
    const res = await creditPendingEarning({
      mentorId: 'mentor-legacy-rate',
      bookingId: 'bk-legacy-rate-1',
      grossAmount: 4000,
    });
    expect(res.split.mentorNet).toBe(2800); // 70%
    expect(res.split.platformCommission).toBe(1200);
    expect(res.split.platformRate).toBe(0.3);
  });
});
