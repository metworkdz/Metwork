/**
 * Unit tests for the centralized MANUAL withdrawal service
 * (src/server/withdrawals/service.ts) — the single create/approve/reject path
 * for both the user wallet and the mentor ledger.
 *
 * Pins the money invariants of the manual flow:
 *   • hold at REQUEST time (funds can't be requested twice)
 *   • bank/ccp require a MATCHING saved payout account, snapshotted onto the
 *     request (a later account edit can't redirect an in-flight withdrawal)
 *   • approve settles the hold IDEMPOTENTLY (replay never double-debits)
 *   • reject releases the hold IDEMPOTENTLY (replay never double-refunds)
 * Runs against the in-memory Supabase mock from setup.ts, exercising the real
 * db.update critical section.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type PayoutAccount } from '@/server/db/store';
import {
  createWithdrawalRequest,
  approveWithdrawal,
  rejectWithdrawal,
  attachReceipt,
  setPayoutAccount,
  isValidPayoutAccountNumber,
  maskAccountNumber,
  MIN_WITHDRAWAL,
} from '@/server/withdrawals/service';

const NOW = '2026-07-01T10:00:00.000Z';
const USER = 'user-wd-1';
const MENTOR = 'mentor-wd-1';
const ADMIN = 'admin-wd-1';

const BANK_ACCOUNT: PayoutAccount = {
  accountType: 'bank',
  accountNumber: '00799999000123456789',
  holderName: 'Test User',
};
const CCP_ACCOUNT: PayoutAccount = {
  accountType: 'ccp',
  accountNumber: '00799999000987654321',
  holderName: 'Test User',
};

async function seedUser(opts: { balance: number; payoutAccount?: PayoutAccount | null; frozen?: boolean }): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.users)) d.users = [];
    if (!Array.isArray(d.wallets)) d.wallets = [];
    if (!Array.isArray(d.transactions)) d.transactions = [];
    if (!Array.isArray(d.withdrawalRequests)) d.withdrawalRequests = [];

    d.users.push({
      id: USER,
      email: 'wd@example.com',
      passwordHash: 'h',
      fullName: 'Test User',
      phone: '+213500000001',
      city: 'Algiers',
      role: 'ENTREPRENEUR',
      status: 'ACTIVE',
      phoneVerified: true,
      emailVerified: true,
      membershipCode: null,
      membershipTier: 'EXPLORER',
      avatarUrl: null,
      locale: 'fr',
      payoutAccount: opts.payoutAccount ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.wallets.push({
      id: 'w-wd-1',
      userId: USER,
      balance: opts.balance,
      currency: 'DZD',
      status: opts.frozen ? 'FROZEN' : 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function seedMentor(opts: { available: number; payoutAccount?: PayoutAccount | null }): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.mentors)) d.mentors = [];
    if (!Array.isArray(d.mentorWallets)) d.mentorWallets = [];
    if (!Array.isArray(d.mentorLedgerTxns)) d.mentorLedgerTxns = [];
    if (!Array.isArray(d.mentorWithdrawals)) d.mentorWithdrawals = [];

    d.mentors.push({
      id: MENTOR,
      fullName: 'Test Consultant',
      position: 'Advisor',
      imageUrl: '',
      bio: null,
      linkedinUrl: null,
      email: 'consultant@example.com',
      payoutAccount: opts.payoutAccount ?? null,
      createdAt: NOW,
    });
    d.mentorWallets.push({
      id: 'mw-wd-1',
      mentorId: MENTOR,
      pendingBalance: 0,
      availableBalance: opts.available,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

// ────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────

describe('payout account validation', () => {
  it('accepts exactly 20 digits (spaces tolerated) for RIB and RIP alike', () => {
    expect(isValidPayoutAccountNumber('00799999000123456789')).toBe(true);
    expect(isValidPayoutAccountNumber('0079 9999 0001 2345 6789')).toBe(true);
    expect(isValidPayoutAccountNumber('123456789')).toBe(false);
    expect(isValidPayoutAccountNumber('0079999900012345678X')).toBe(false);
    expect(isValidPayoutAccountNumber('007999990001234567890')).toBe(false);
  });

  it('masks account numbers to the last 4 digits', () => {
    expect(maskAccountNumber('00799999000123456789')).toBe('****6789');
  });

  it('setPayoutAccount stores a normalized account and rejects bad numbers', async () => {
    await seedUser({ balance: 0 });
    const bad = await setPayoutAccount({
      targetType: 'user',
      targetId: USER,
      account: { ...BANK_ACCOUNT, accountNumber: '1234' },
    });
    expect(bad).toEqual({ ok: false, reason: 'INVALID_ACCOUNT_NUMBER' });

    const good = await setPayoutAccount({
      targetType: 'user',
      targetId: USER,
      account: { ...BANK_ACCOUNT, accountNumber: '0079 9999 0001 2345 6789' },
    });
    expect(good.ok).toBe(true);
    const data = await db.read();
    expect(data.users.find((u) => u.id === USER)?.payoutAccount?.accountNumber).toBe(
      '00799999000123456789',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Create — user wallet
// ────────────────────────────────────────────────────────────────────────

describe('createWithdrawalRequest (user wallet)', () => {
  it('rejects bank_transfer without a saved bank account', async () => {
    await seedUser({ balance: 10_000 });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: 'bank_transfer',
    });
    expect(res).toEqual({ ok: false, reason: 'NO_PAYOUT_ACCOUNT', requiredType: 'bank' });
  });

  it('rejects a method that does not match the saved account type', async () => {
    await seedUser({ balance: 10_000, payoutAccount: CCP_ACCOUNT });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: 'bank_transfer',
    });
    expect(res).toEqual({ ok: false, reason: 'NO_PAYOUT_ACCOUNT', requiredType: 'bank' });
  });

  it('holds the amount at request time and snapshots the destination', async () => {
    await seedUser({ balance: 10_000, payoutAccount: BANK_ACCOUNT });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 4_000, method: 'bank_transfer',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.request.method).toBe('bank_transfer');
    expect(res.request.destinationAccountSnapshot).toEqual(BANK_ACCOUNT);
    expect(res.request.status).toBe('PENDING');

    const data = await db.read();
    expect(data.wallets.find((w) => w.userId === USER)?.balance).toBe(6_000);
    const hold = data.transactions.find(
      (t) => 'holdTransactionId' in res.request && t.id === res.request.holdTransactionId,
    );
    expect(hold?.status).toBe('PENDING');
    expect(hold?.amount).toBe(-4_000);

    // The same (held) funds can't be requested twice.
    const second = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 8_000, method: 'bank_transfer',
    });
    expect(second).toMatchObject({ ok: false, reason: 'INSUFFICIENT_FUNDS', available: 6_000 });
  });

  it('a later payout-account edit does not change the frozen snapshot', async () => {
    await seedUser({ balance: 10_000, payoutAccount: BANK_ACCOUNT });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: 'bank_transfer',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    await setPayoutAccount({
      targetType: 'user', targetId: USER,
      account: { ...BANK_ACCOUNT, accountNumber: '11111111111111111111' },
    });
    const data = await db.read();
    const stored = data.withdrawalRequests.find((r) => r.id === res.request.id);
    expect(stored?.destinationAccountSnapshot?.accountNumber).toBe(BANK_ACCOUNT.accountNumber);
  });

  it('cheque needs no payout account (snapshot stays null)', async () => {
    await seedUser({ balance: 10_000 });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: 'cheque',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.request.method).toBe('cheque');
    expect(res.request.destinationAccountSnapshot).toBeNull();
  });

  it('legacy free-text requests (no method) still work through the same hold path', async () => {
    await seedUser({ balance: 10_000 });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: null,
      legacyAccountDetails: 'CCP 12345 clé 67',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.request.method).toBeNull();
    expect(res.request.accountDetails).toBe('CCP 12345 clé 67');
    const data = await db.read();
    expect(data.wallets.find((w) => w.userId === USER)?.balance).toBe(9_000);
  });

  it('enforces amount floor, frozen wallet and balance', async () => {
    await seedUser({ balance: 1_000 });
    expect(await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: MIN_WITHDRAWAL - 1, method: 'cheque',
    })).toMatchObject({ ok: false, reason: 'BELOW_MINIMUM' });
    expect(await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 2_000, method: 'cheque',
    })).toMatchObject({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
    expect(await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: -500, method: 'cheque',
    })).toMatchObject({ ok: false, reason: 'INVALID_AMOUNT' });
  });

  it('rejects requests from a frozen wallet', async () => {
    await seedUser({ balance: 10_000, frozen: true });
    expect(await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: 'cheque',
    })).toEqual({ ok: false, reason: 'WALLET_FROZEN' });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Approve / reject — user wallet (idempotency)
// ────────────────────────────────────────────────────────────────────────

describe('approve / reject (user wallet)', () => {
  let requestId: string;

  beforeEach(async () => {
    await seedUser({ balance: 10_000, payoutAccount: BANK_ACCOUNT });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 4_000, method: 'bank_transfer',
    });
    if (!res.ok) throw new Error('seed request failed');
    requestId = res.request.id;
  });

  it('approve settles the hold and stamps audit fields', async () => {
    const res = await approveWithdrawal({
      targetType: 'user', requestId, adminId: ADMIN, receiptUrl: 'https://cdn.example.com/receipt.png',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.replayed).toBe(false);
    expect(res.request.status).toBe('APPROVED');
    expect(res.request.approvedAt).toBeTruthy();
    expect(res.request.processedByAdminId).toBe(ADMIN);
    expect(res.request.receiptUrl).toBe('https://cdn.example.com/receipt.png');

    const data = await db.read();
    const stored = data.withdrawalRequests.find((r) => r.id === requestId)!;
    const hold = data.transactions.find((t) => t.id === stored.holdTransactionId);
    expect(hold?.status).toBe('COMPLETED');
    // Balance unchanged by approval — the money left at request time.
    expect(data.wallets.find((w) => w.userId === USER)?.balance).toBe(6_000);
  });

  it('approve is idempotent — a double-click never double-debits', async () => {
    const first = await approveWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    const second = await approveWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });

    const data = await db.read();
    expect(data.wallets.find((w) => w.userId === USER)?.balance).toBe(6_000);
    expect(data.transactions.filter((t) => t.type === 'PAYOUT').length).toBe(1);
  });

  it('reject refunds the hold back to the wallet', async () => {
    const res = await rejectWithdrawal({
      targetType: 'user', requestId, adminId: ADMIN, reason: 'Wrong RIB',
    });
    expect(res).toMatchObject({ ok: true, replayed: false });

    const data = await db.read();
    expect(data.wallets.find((w) => w.userId === USER)?.balance).toBe(10_000);
    const stored = data.withdrawalRequests.find((r) => r.id === requestId)!;
    expect(stored.status).toBe('REJECTED');
    expect(stored.processedByAdminId).toBe(ADMIN);
    expect(stored.adminNote).toBe('Wrong RIB');
    const hold = data.transactions.find((t) => t.id === stored.holdTransactionId);
    expect(hold?.status).toBe('REVERSED');
    const refund = data.transactions.find((t) => t.id === stored.refundTransactionId);
    expect(refund?.status).toBe('COMPLETED');
    expect(refund?.amount).toBe(4_000);
  });

  it('reject is idempotent — a retry never double-refunds', async () => {
    await rejectWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    const second = await rejectWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    expect(second).toMatchObject({ ok: true, replayed: true });

    const data = await db.read();
    expect(data.wallets.find((w) => w.userId === USER)?.balance).toBe(10_000);
    expect(data.transactions.filter((t) => t.type === 'REFUND').length).toBe(1);
  });

  it('approve after reject conflicts (and vice versa)', async () => {
    await rejectWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    const res = await approveWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    expect(res).toEqual({ ok: false, reason: 'ALREADY_RESOLVED' });
  });

  it('reject fails cleanly when the wallet is frozen (no lost funds)', async () => {
    await db.update((d) => {
      const w = d.wallets.find((x) => x.userId === USER)!;
      w.status = 'FROZEN';
    });
    const res = await rejectWithdrawal({ targetType: 'user', requestId, adminId: ADMIN });
    expect(res).toEqual({ ok: false, reason: 'WALLET_FROZEN' });
    const data = await db.read();
    expect(data.withdrawalRequests.find((r) => r.id === requestId)?.status).toBe('PENDING');
  });

  it('unknown request ids return NOT_FOUND', async () => {
    expect(await approveWithdrawal({ targetType: 'user', requestId: 'nope', adminId: ADMIN }))
      .toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Mentor ledger (same service, parallel ledger)
// ────────────────────────────────────────────────────────────────────────

describe('withdrawals (mentor ledger)', () => {
  it('holds from AVAILABLE with a snapshot, approves idempotently', async () => {
    await seedMentor({ available: 8_000, payoutAccount: CCP_ACCOUNT });
    const res = await createWithdrawalRequest({
      targetType: 'mentor', targetId: MENTOR, amount: 3_000, method: 'ccp',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.request.method).toBe('ccp');
    expect(res.request.destinationAccountSnapshot).toEqual(CCP_ACCOUNT);

    let data = await db.read();
    expect(data.mentorWallets?.find((w) => w.mentorId === MENTOR)?.availableBalance).toBe(5_000);

    const first = await approveWithdrawal({ targetType: 'mentor', requestId: res.request.id, adminId: ADMIN });
    const second = await approveWithdrawal({ targetType: 'mentor', requestId: res.request.id, adminId: ADMIN });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });

    data = await db.read();
    const stored = (data.mentorWithdrawals ?? []).find((r) => r.id === res.request.id)!;
    expect(stored.status).toBe('APPROVED');
    expect(stored.approvedAt).toBeTruthy();
    expect(stored.processedByAdminId).toBe(ADMIN);
    expect(data.mentorWallets?.find((w) => w.mentorId === MENTOR)?.availableBalance).toBe(5_000);
    const hold = (data.mentorLedgerTxns ?? []).find((t) => t.id === stored.holdTxnId);
    expect(hold?.status).toBe('COMPLETED');
  });

  it('requires a matching account for ccp withdrawals', async () => {
    await seedMentor({ available: 8_000, payoutAccount: BANK_ACCOUNT });
    const res = await createWithdrawalRequest({
      targetType: 'mentor', targetId: MENTOR, amount: 3_000, method: 'ccp',
    });
    expect(res).toEqual({ ok: false, reason: 'NO_PAYOUT_ACCOUNT', requiredType: 'ccp' });
  });

  it('reject refunds AVAILABLE and replays idempotently', async () => {
    await seedMentor({ available: 8_000 });
    const res = await createWithdrawalRequest({
      targetType: 'mentor', targetId: MENTOR, amount: 3_000, method: 'cheque',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const first = await rejectWithdrawal({ targetType: 'mentor', requestId: res.request.id, adminId: ADMIN, reason: 'no' });
    const second = await rejectWithdrawal({ targetType: 'mentor', requestId: res.request.id, adminId: ADMIN, reason: 'no' });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });

    const data = await db.read();
    expect(data.mentorWallets?.find((w) => w.mentorId === MENTOR)?.availableBalance).toBe(8_000);
    expect((data.mentorLedgerTxns ?? []).filter((t) => t.type === 'REVERSAL').length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Receipt attachment
// ────────────────────────────────────────────────────────────────────────

describe('attachReceipt', () => {
  it('saves the receipt reference before approval', async () => {
    await seedUser({ balance: 10_000 });
    const res = await createWithdrawalRequest({
      targetType: 'user', targetId: USER, amount: 1_000, method: 'cheque',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const attached = await attachReceipt({
      targetType: 'user', requestId: res.request.id, receiptUrl: 'https://cdn.example.com/r.png',
    });
    expect(attached.ok).toBe(true);

    const data = await db.read();
    expect(data.withdrawalRequests.find((r) => r.id === res.request.id)?.receiptUrl)
      .toBe('https://cdn.example.com/r.png');
  });

  it('returns NOT_FOUND for unknown requests', async () => {
    expect(await attachReceipt({ targetType: 'user', requestId: 'nope', receiptUrl: 'x' }))
      .toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
