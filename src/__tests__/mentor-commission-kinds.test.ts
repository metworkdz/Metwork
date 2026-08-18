/**
 * Consultant commission is keyed by WHAT the earning is for (2026-08-19):
 *
 *   • MENTOR_CONSULTATION — 1:1 sessions, default 20 % platform / 80 % them
 *   • MENTOR_PROGRAM      — consultant-owned programs, default 5 % / 95 %
 *
 * Replaces the retired source-based tiering (MENTOR_CONSULTATION_SELF, 20 %),
 * which existed only to give portal self-signups a better rate than the old
 * 30 % standard. Now that the standard consultation rate IS 20 %, one rate
 * applies to every consultant and `MentorRecord.source` no longer affects the
 * split. Both rules stay admin-configurable.
 */
import { describe, it, expect } from 'vitest';
import { db, type CommissionRuleRecord, type MentorRecord } from '@/server/db/store';
import {
  computeMentorPromoSplit,
  resolveMentorCommissionRates,
  DEFAULT_MENTOR_PLATFORM_RATE,
  DEFAULT_MENTOR_PROGRAM_PLATFORM_RATE,
  MENTOR_CONSULTATION_RULE_TYPE,
  MENTOR_PROGRAM_RULE_TYPE,
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

describe('resolveMentorCommissionRates — rate by kind', () => {
  it('defaults consultations to 20% platform / 80% consultant', () => {
    expect(DEFAULT_MENTOR_PLATFORM_RATE).toBe(0.2);
    const { platformRate, mentorRate } = resolveMentorCommissionRates([], { kind: 'CONSULTATION' });
    expect(platformRate).toBe(0.2);
    expect(mentorRate).toBeCloseTo(0.8, 10);
  });

  it('defaults programs to 5% platform / 95% consultant', () => {
    expect(DEFAULT_MENTOR_PROGRAM_PLATFORM_RATE).toBe(0.05);
    const { platformRate, mentorRate } = resolveMentorCommissionRates([], { kind: 'PROGRAM' });
    expect(platformRate).toBe(0.05);
    expect(mentorRate).toBeCloseTo(0.95, 10);
  });

  it('treats an absent/null context as CONSULTATION (back-compat)', () => {
    for (const context of [undefined, null, {}, { kind: null }]) {
      expect(resolveMentorCommissionRates([], context).platformRate).toBe(0.2);
    }
  });

  it('source no longer affects the split — the SELF tier is retired', () => {
    // The old tiering key is inert: passing it changes nothing.
    const asAny = { source: 'SELF' } as unknown as { kind?: 'CONSULTATION' };
    expect(resolveMentorCommissionRates([], asAny).platformRate).toBe(0.2);
    // A stray legacy MENTOR_CONSULTATION_SELF row is never consulted.
    const stale = [rule('MENTOR_CONSULTATION_SELF', 0.99), rule(MENTOR_CONSULTATION_RULE_TYPE, 0.2)];
    expect(resolveMentorCommissionRates(stale, asAny).platformRate).toBe(0.2);
  });

  it('prefers active admin-configured rules, per kind, independently', () => {
    const rules = [rule(MENTOR_CONSULTATION_RULE_TYPE, 0.35), rule(MENTOR_PROGRAM_RULE_TYPE, 0.1)];
    expect(resolveMentorCommissionRates(rules, { kind: 'CONSULTATION' }).platformRate).toBe(0.35);
    expect(resolveMentorCommissionRates(rules, { kind: 'PROGRAM' }).platformRate).toBe(0.1);
  });

  it('falls back to the seeded default when the rule is inactive', () => {
    expect(
      resolveMentorCommissionRates([rule(MENTOR_PROGRAM_RULE_TYPE, 0.5, false)], { kind: 'PROGRAM' })
        .platformRate,
    ).toBe(0.05);
  });

  it('pays 95% of the base price on a program split', () => {
    const split = computeMentorPromoSplit(
      { basePrice: 4000, collectedAmount: 4000 },
      [],
      { kind: 'PROGRAM' },
    );
    expect(split.consultantShare).toBe(3800); // 95%
    expect(split.platformShare).toBe(200);
  });
});

describe('creditPendingEarning — kind selects the rule', () => {
  it('credits a program earning at 5%', async () => {
    await db.update((d) => {
      if (!Array.isArray(d.mentors)) d.mentors = [];
      d.mentors.push(mentorRecord('mentor-prog-rate', 'SELF'));
      d.commissionRules = [];
    });
    const res = await creditPendingEarning({
      mentorId: 'mentor-prog-rate',
      bookingId: 'bk-prog-rate-1',
      grossAmount: 4000,
      kind: 'PROGRAM',
    });
    expect(res.replayed).toBe(false);
    expect(res.split.mentorNet).toBe(3800); // 95%
    expect(res.split.platformCommission).toBe(200);
    expect(res.split.platformRate).toBe(0.05);
  });

  it('defaults to the consultation rate when kind is omitted', async () => {
    await db.update((d) => {
      if (!Array.isArray(d.mentors)) d.mentors = [];
      d.mentors.push(mentorRecord('mentor-default-kind'));
      d.commissionRules = [];
    });
    const res = await creditPendingEarning({
      mentorId: 'mentor-default-kind',
      bookingId: 'bk-default-kind-1',
      grossAmount: 4000,
    });
    expect(res.split.mentorNet).toBe(3200); // 80%
    expect(res.split.platformCommission).toBe(800);
    expect(res.split.platformRate).toBe(0.2);
  });

  it('freezes the resolved rate into the ledger txn so later rate changes never rewrite it', async () => {
    await db.update((d) => {
      if (!Array.isArray(d.mentors)) d.mentors = [];
      d.mentors.push(mentorRecord('mentor-frozen'));
      d.commissionRules = [];
    });
    await creditPendingEarning({
      mentorId: 'mentor-frozen',
      bookingId: 'bk-frozen-1',
      grossAmount: 4000,
      kind: 'PROGRAM',
    });
    // Admin later doubles the program rate.
    await db.update((d) => { d.commissionRules = [rule(MENTOR_PROGRAM_RULE_TYPE, 0.5)]; });

    const data = await db.read();
    const txn = (data.mentorLedgerTxns ?? []).find(
      (t) => t.reference === 'mentor-earning-bk-frozen-1',
    );
    expect(txn).toBeDefined();
    expect(txn!.amount).toBe(3800);
    expect((txn!.metadata as { platformRate: number }).platformRate).toBe(0.05);
  });
});
