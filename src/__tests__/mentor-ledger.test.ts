/**
 * Unit tests for the parallel mentor (consultant) earnings ledger
 * (src/server/mentors/ledger.ts) and its commission resolver
 * (src/server/payments/mentor-commission.ts).
 *
 * These pin the money math and idempotency of the dormant ledger before it is
 * wired into the booking/settlement path: the 30/70 default split, pending vs.
 * available buckets, release/void semantics, replay safety, and the withdrawal
 * escrow → approve/reject lifecycle. Each test runs against the in-memory
 * Supabase mock from setup.ts, exercising the real db.update critical section.
 */
import { describe, it, expect } from 'vitest';
import { db, type CommissionRuleRecord } from '@/server/db/store';
import {
  computeMentorEarningSplit,
  resolveMentorCommissionRates,
  DEFAULT_MENTOR_PLATFORM_RATE,
} from '@/server/payments/mentor-commission';
import {
  creditPendingEarning,
  releaseToAvailable,
  voidPendingEarning,
  requestMentorWithdrawal,
  resolveMentorWithdrawal,
  getMentorLedgerView,
  MIN_MENTOR_WITHDRAWAL,
} from '@/server/mentors/ledger';

const MENTOR = 'mentor-led-1';

/** Seed an active MENTOR_CONSULTATION rule with a custom platform rate. */
async function seedConsultationRule(rate: number): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.commissionRules)) d.commissionRules = [];
    const rule: CommissionRuleRecord = {
      id: 'rule_mentor_consultation',
      name: 'Mentor consultation commission',
      transactionType: 'MENTOR_CONSULTATION',
      rate,
      description: 'test',
      isActive: true,
      updatedAt: new Date(0).toISOString(),
    };
    d.commissionRules = [rule];
  });
}

describe('resolveMentorCommissionRates / computeMentorEarningSplit', () => {
  it('defaults to a 30% platform / 70% mentor split when no rule is configured', () => {
    expect(DEFAULT_MENTOR_PLATFORM_RATE).toBe(0.3);
    const { platformRate, mentorRate } = resolveMentorCommissionRates([]);
    expect(platformRate).toBe(0.3);
    expect(mentorRate).toBeCloseTo(0.7, 10);
  });

  it('splits gross into commission + net that always sum back exactly', () => {
    const split = computeMentorEarningSplit(10_000, []);
    expect(split.platformCommission).toBe(3_000); // 30%
    expect(split.mentorNet).toBe(7_000); // remainder
    expect(split.platformCommission + split.mentorNet).toBe(split.gross);
  });

  it('honours an admin-configured rate and ignores inactive rules', () => {
    const active = resolveMentorCommissionRates([
      { id: 'r', name: 'n', transactionType: 'MENTOR_CONSULTATION', rate: 0.1, description: '', isActive: true, updatedAt: '' },
    ]);
    expect(active.platformRate).toBe(0.1);

    const inactive = resolveMentorCommissionRates([
      { id: 'r', name: 'n', transactionType: 'MENTOR_CONSULTATION', rate: 0.1, description: '', isActive: false, updatedAt: '' },
    ]);
    expect(inactive.platformRate).toBe(0.3); // falls back to default
  });

  it('treats a zero/negative gross as a no-op split', () => {
    expect(computeMentorEarningSplit(0, []).mentorNet).toBe(0);
    expect(computeMentorEarningSplit(-50, []).mentorNet).toBe(0);
  });
});

describe('creditPendingEarning', () => {
  it('credits net to PENDING and records the commission for audit', async () => {
    const res = await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    expect(res.replayed).toBe(false);
    expect(res.wallet.pendingBalance).toBe(7_000);
    expect(res.wallet.availableBalance).toBe(0);

    const { txns } = await getMentorLedgerView(MENTOR);
    const earning = txns.find((t) => t.type === 'EARNING');
    const commission = txns.find((t) => t.type === 'COMMISSION');
    expect(earning?.amount).toBe(7_000);
    expect(earning?.bucket).toBe('PENDING');
    expect(commission?.amount).toBe(-3_000);
  });

  it('is idempotent — a replay does not double-credit', async () => {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    const replay = await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    expect(replay.replayed).toBe(true);
    expect(replay.wallet.pendingBalance).toBe(7_000); // not 14 000

    const { txns } = await getMentorLedgerView(MENTOR);
    expect(txns.filter((t) => t.type === 'EARNING')).toHaveLength(1);
  });

  it('uses the admin-configured rate when present', async () => {
    await seedConsultationRule(0.2);
    const res = await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    expect(res.wallet.pendingBalance).toBe(8_000); // 80%
  });
});

describe('releaseToAvailable', () => {
  it('moves a held earning from PENDING → AVAILABLE on completion', async () => {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    const res = await releaseToAvailable({ mentorId: MENTOR, bookingId: 'b1' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.wallet.pendingBalance).toBe(0);
      expect(res.wallet.availableBalance).toBe(7_000);
    }
  });

  it('is idempotent and refuses when no earning exists', async () => {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    await releaseToAvailable({ mentorId: MENTOR, bookingId: 'b1' });
    const replay = await releaseToAvailable({ mentorId: MENTOR, bookingId: 'b1' });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.wallet.availableBalance).toBe(7_000); // not 14 000
    }

    const missing = await releaseToAvailable({ mentorId: MENTOR, bookingId: 'nope' });
    expect(missing.ok).toBe(false);
  });
});

describe('voidPendingEarning', () => {
  it('removes an unreleased earning from PENDING', async () => {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    const res = await voidPendingEarning({ mentorId: MENTOR, bookingId: 'b1' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.wallet.pendingBalance).toBe(0);
  });

  it('refuses to void an earning that was already released', async () => {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    await releaseToAvailable({ mentorId: MENTOR, bookingId: 'b1' });
    const res = await voidPendingEarning({ mentorId: MENTOR, bookingId: 'b1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('ALREADY_RELEASED');
  });

  it('a voided earning can no longer be released', async () => {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: 10_000 });
    await voidPendingEarning({ mentorId: MENTOR, bookingId: 'b1' });
    const res = await releaseToAvailable({ mentorId: MENTOR, bookingId: 'b1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('EARNING_REVERSED');
  });
});

describe('withdrawals', () => {
  async function seedAvailable(amount: number): Promise<void> {
    await creditPendingEarning({ mentorId: MENTOR, bookingId: 'b1', grossAmount: Math.round(amount / 0.7) });
    await releaseToAvailable({ mentorId: MENTOR, bookingId: 'b1' });
  }

  it('holds the amount in escrow from AVAILABLE on request', async () => {
    await seedAvailable(7_000);
    const res = await requestMentorWithdrawal({ mentorId: MENTOR, amount: 5_000, accountDetails: 'CCP 123' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.wallet.availableBalance).toBe(2_000);
  });

  it('rejects below-minimum and over-balance requests', async () => {
    await seedAvailable(7_000);
    const tooSmall = await requestMentorWithdrawal({ mentorId: MENTOR, amount: MIN_MENTOR_WITHDRAWAL - 1, accountDetails: 'x' });
    expect(tooSmall.ok).toBe(false);

    const tooBig = await requestMentorWithdrawal({ mentorId: MENTOR, amount: 999_999, accountDetails: 'x' });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok && tooBig.reason === 'INSUFFICIENT_FUNDS') expect(tooBig.available).toBe(7_000);
  });

  it('APPROVED settles the hold without touching the balance again', async () => {
    await seedAvailable(7_000);
    const req = await requestMentorWithdrawal({ mentorId: MENTOR, amount: 5_000, accountDetails: 'CCP 123' });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    const resolved = await resolveMentorWithdrawal({ id: req.request.id, status: 'APPROVED' });
    expect(resolved.ok).toBe(true);

    const { wallet, txns } = await getMentorLedgerView(MENTOR);
    expect(wallet.availableBalance).toBe(2_000); // unchanged by approval
    const hold = txns.find((t) => t.id === req.request.holdTxnId);
    expect(hold?.status).toBe('COMPLETED');
  });

  it('REJECTED refunds the held amount back to AVAILABLE', async () => {
    await seedAvailable(7_000);
    const req = await requestMentorWithdrawal({ mentorId: MENTOR, amount: 5_000, accountDetails: 'CCP 123' });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    const resolved = await resolveMentorWithdrawal({ id: req.request.id, status: 'REJECTED', adminNote: 'bad details' });
    expect(resolved.ok).toBe(true);

    const { wallet, txns } = await getMentorLedgerView(MENTOR);
    expect(wallet.availableBalance).toBe(7_000); // restored
    const hold = txns.find((t) => t.id === req.request.holdTxnId);
    expect(hold?.status).toBe('REVERSED');
    expect(txns.some((t) => t.type === 'REVERSAL' && t.amount === 5_000)).toBe(true);
  });

  it('is idempotent — a resolved request cannot be resolved twice', async () => {
    await seedAvailable(7_000);
    const req = await requestMentorWithdrawal({ mentorId: MENTOR, amount: 5_000, accountDetails: 'CCP 123' });
    if (!req.ok) throw new Error('setup failed');
    await resolveMentorWithdrawal({ id: req.request.id, status: 'APPROVED' });
    const again = await resolveMentorWithdrawal({ id: req.request.id, status: 'REJECTED' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('ALREADY_RESOLVED');
  });
});
