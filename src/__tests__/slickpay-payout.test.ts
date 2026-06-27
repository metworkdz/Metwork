/**
 * Tests for automated SlickPay payouts (src/server/payouts/service.ts).
 *
 * Pins the money-path guarantees the admin payments feature depends on:
 *  - the escrow hold settles ONLY once SlickPay confirms "sent";
 *  - a failed/in-flight dispatch leaves the wallet untouched (retryable);
 *  - a double-click never sends twice (PROCESSING claim guard);
 *  - finalize + reconcile are idempotent.
 *
 * The SlickPay client is mocked so no HTTP happens; the real db.update critical
 * sections (in-memory Supabase mock from setup.ts) are exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  db,
  type MentorLedgerTxnRecord,
  type MentorWalletRecord,
  type MentorWithdrawalRecord,
  type PayoutBeneficiary,
  type TransactionRecord,
  type WalletRecord,
  type WithdrawalRequestRecord,
} from '@/server/db/store';

const sp = vi.hoisted(() => ({
  createBeneficiary: vi.fn(),
  createDisbursement: vi.fn(),
  status: vi.fn(),
  commission: vi.fn(),
}));

vi.mock('@/server/payments/slickpay-provider', () => ({
  createSlickpayBeneficiary: sp.createBeneficiary,
  createSlickpayDisbursement: sp.createDisbursement,
  getSlickPayTransferStatus: sp.status,
  getSlickpayTransferCommission: sp.commission,
}));

import {
  processUserSlickpayPayout,
  processMentorSlickpayPayout,
  reconcilePendingPayouts,
  registerPayoutContact,
  sendTransfer,
  previewTransfer,
  getPayableTargets,
  maskRib,
} from '@/server/payouts/service';
import type { UserRecord } from '@/server/db/store';

const RIB = '00799999000123456789'; // 20 digits
const BENEFICIARY: PayoutBeneficiary = {
  rib: RIB,
  firstname: 'Sara',
  lastname: 'Benali',
  address: 'Algiers',
};

beforeEach(() => {
  sp.createBeneficiary.mockReset().mockResolvedValue({ uuid: 'acc-1' });
  sp.createDisbursement.mockReset().mockResolvedValue({ transferId: 'tr-1', redirectUrl: null, raw: {} });
  sp.status.mockReset().mockResolvedValue({ completed: 1 });
  sp.commission.mockReset().mockResolvedValue({ commission: 50 });
});

const now = () => new Date().toISOString();

/** Seed a user wallet (already reduced by the reservation) + a PENDING hold. */
async function seedUserWithdrawal(amount: number, remainingBalance = 0): Promise<string> {
  return db.update((d) => {
    const wallet: WalletRecord = {
      id: 'w1', userId: 'u1', balance: remainingBalance, currency: 'DZD',
      status: 'ACTIVE', createdAt: now(), updatedAt: now(),
    };
    const hold: TransactionRecord = {
      id: 'hold1', walletId: 'w1', userId: 'u1', type: 'PAYOUT', amount: -amount,
      balanceAfter: remainingBalance, status: 'PENDING', description: 'hold',
      reference: 'withdrawal-hold-1', provider: 'internal', providerTxnId: null,
      metadata: {}, createdAt: now(), completedAt: null,
    };
    const req: WithdrawalRequestRecord = {
      id: 'req1', userId: 'u1', amount, accountDetails: 'CCP 123', status: 'PENDING',
      holdTransactionId: 'hold1', createdAt: now(), updatedAt: now(),
    };
    d.wallets.push(wallet);
    d.transactions.push(hold);
    d.withdrawalRequests.push(req);
    return 'req1';
  });
}

async function seedMentorWithdrawal(amount: number, available = 0): Promise<string> {
  return db.update((d) => {
    d.mentorWallets ??= [];
    d.mentorLedgerTxns ??= [];
    d.mentorWithdrawals ??= [];
    const wallet: MentorWalletRecord = {
      id: 'mw1', mentorId: 'm1', pendingBalance: 0, availableBalance: available,
      currency: 'DZD', status: 'ACTIVE', createdAt: now(), updatedAt: now(),
    };
    const hold: MentorLedgerTxnRecord = {
      id: 'mh1', mentorId: 'm1', bookingId: null, type: 'PAYOUT', amount: -amount,
      bucket: 'AVAILABLE', status: 'PENDING', reference: 'mentor-withdrawal-hold-1',
      description: 'hold', metadata: {}, createdAt: now(), completedAt: null,
    };
    const req: MentorWithdrawalRecord = {
      id: 'mreq1', mentorId: 'm1', amount, accountDetails: 'CCP 9', status: 'PENDING',
      holdTxnId: 'mh1', createdAt: now(), updatedAt: now(),
    };
    d.mentorWallets.push(wallet);
    d.mentorLedgerTxns.push(hold);
    d.mentorWithdrawals.push(req);
    return 'mreq1';
  });
}

const getReq = async () =>
  (await db.read()).withdrawalRequests.find((r) => r.id === 'req1')!;
const getHold = async () =>
  (await db.read()).transactions.find((t) => t.id === 'hold1')!;
const getWallet = async () =>
  (await db.read()).wallets.find((w) => w.id === 'w1')!;

describe('processUserSlickpayPayout', () => {
  it('settles the hold and marks SENT once SlickPay confirms completed=1', async () => {
    await seedUserWithdrawal(5000, 0);

    const res = await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });

    expect(res).toEqual({ ok: true, finalStatus: 'SENT', redirectUrl: null });
    const req = await getReq();
    expect(req.status).toBe('APPROVED');
    expect(req.payoutMethod).toBe('SLICKPAY');
    expect(req.payoutStatus).toBe('SENT');
    expect(req.payoutFee).toBe(50);
    expect(req.payoutProviderRef).toBe('tr-1');
    expect((await getHold()).status).toBe('COMPLETED');
    // Balance was already reduced at request time — settlement does not touch it.
    expect((await getWallet()).balance).toBe(0);
    expect(sp.createDisbursement).toHaveBeenCalledTimes(1);
  });

  it('leaves the payout PROCESSING (hold untouched) when SlickPay is not yet sent', async () => {
    await seedUserWithdrawal(5000);
    sp.status.mockResolvedValue({ completed: 0 });

    const res = await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });

    expect(res).toEqual({ ok: true, finalStatus: 'PROCESSING', redirectUrl: null });
    const req = await getReq();
    expect(req.status).toBe('PENDING');
    expect(req.payoutStatus).toBe('PROCESSING');
    expect(req.payoutProviderRef).toBe('tr-1');
    expect((await getHold()).status).toBe('PENDING');
  });

  it('does not send twice on a concurrent re-trigger (PROCESSING guard)', async () => {
    await seedUserWithdrawal(5000);
    sp.status.mockResolvedValue({ completed: 0 });

    await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });
    const second = await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });

    expect(second).toEqual({ ok: false, reason: 'ALREADY_PROCESSING' });
    expect(sp.createDisbursement).toHaveBeenCalledTimes(1);
  });

  it('marks FAILED and leaves the wallet untouched when dispatch errors (retryable)', async () => {
    await seedUserWithdrawal(5000, 0);
    sp.createDisbursement.mockRejectedValueOnce(new Error('SlickPay 422 insufficient balance'));

    const res = await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('DISPATCH_FAILED');
    const req = await getReq();
    expect(req.status).toBe('PENDING'); // still actionable
    expect(req.payoutStatus).toBe('FAILED');
    expect(req.payoutFailureReason).toContain('insufficient balance');
    expect((await getHold()).status).toBe('PENDING'); // money untouched
    expect((await getWallet()).balance).toBe(0);
  });

  it('can be retried after a failure and then settles', async () => {
    await seedUserWithdrawal(5000);
    sp.createDisbursement.mockRejectedValueOnce(new Error('network'));
    await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });

    // Retry: dispatch now succeeds + confirmed sent.
    const res = await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });
    expect(res).toEqual({ ok: true, finalStatus: 'SENT', redirectUrl: null });
    expect((await getReq()).payoutStatus).toBe('SENT');
    expect((await getHold()).status).toBe('COMPLETED');
  });

  it('rejects an invalid RIB without calling SlickPay', async () => {
    await seedUserWithdrawal(5000);
    const res = await processUserSlickpayPayout({
      requestId: 'req1',
      beneficiary: { ...BENEFICIARY, rib: '12345' },
    });
    expect(res).toEqual({ ok: false, reason: 'INVALID_RIB' });
    expect(sp.createDisbursement).not.toHaveBeenCalled();
  });
});

describe('reconcilePendingPayouts', () => {
  it('finalizes a PROCESSING payout once SlickPay reports sent — idempotently', async () => {
    await seedUserWithdrawal(5000);
    sp.status.mockResolvedValueOnce({ completed: 0 });
    await processUserSlickpayPayout({ requestId: 'req1', beneficiary: BENEFICIARY });
    expect((await getReq()).payoutStatus).toBe('PROCESSING');

    sp.status.mockResolvedValue({ completed: 1 });
    const first = await reconcilePendingPayouts();
    expect(first.settled).toBe(1);
    expect((await getReq()).payoutStatus).toBe('SENT');
    expect((await getHold()).status).toBe('COMPLETED');

    // Re-running settles nothing more (already SENT).
    const second = await reconcilePendingPayouts();
    expect(second.settled).toBe(0);
  });
});

describe('processMentorSlickpayPayout', () => {
  it('settles the mentor hold on sent, leaving availableBalance untouched', async () => {
    await seedMentorWithdrawal(3000, 1000);

    const res = await processMentorSlickpayPayout({ requestId: 'mreq1', beneficiary: BENEFICIARY });

    expect(res).toEqual({ ok: true, finalStatus: 'SENT', redirectUrl: null });
    const data = await db.read();
    const req = data.mentorWithdrawals!.find((r) => r.id === 'mreq1')!;
    expect(req.status).toBe('APPROVED');
    expect(req.payoutStatus).toBe('SENT');
    expect(req.payoutFee).toBe(50);
    expect(data.mentorLedgerTxns!.find((t) => t.id === 'mh1')!.status).toBe('COMPLETED');
    expect(data.mentorWallets!.find((w) => w.id === 'mw1')!.availableBalance).toBe(1000);
  });
});

/* ─────────────── Admin payouts dashboard (bank account + send) ─────────────── */

const BANK = { title: 'Personal', firstname: 'Sara', lastname: 'Benali', address: 'Algiers', rib: RIB };

function makeUser(id: string, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id, email: `${id}@t.test`, passwordHash: 'x', fullName: `User ${id}`, phone: '+213700000000',
    city: 'Algiers', role: 'INCUBATOR', status: 'ACTIVE', phoneVerified: true, emailVerified: true,
    membershipCode: null, avatarUrl: null, locale: 'en', createdAt: now(), updatedAt: now(),
    ...overrides,
  };
}

/** Seed a user + wallet with an optional bank account on file. */
async function seedPayableUser(opts: { balance: number; withBank?: boolean }): Promise<string> {
  return db.update((d) => {
    d.users.push(makeUser('pu1', {
      payoutBankAccount: opts.withBank ? { ...BANK } : null,
      slickpayBeneficiaryUuid: opts.withBank ? 'acc-1' : null,
    }));
    d.wallets.push({
      id: 'puw1', userId: 'pu1', balance: opts.balance, currency: 'DZD',
      status: 'ACTIVE', createdAt: now(), updatedAt: now(),
    });
    return 'pu1';
  });
}

describe('maskRib / previewTransfer', () => {
  it('masks a RIB to its last 4 digits', () => {
    expect(maskRib(RIB)).toBe('****6789');
  });

  it('rejects a preview below the 500 minimum and prices an ok one', async () => {
    expect(await previewTransfer(100)).toEqual({ ok: false, reason: 'BELOW_MINIMUM', minimum: 500 });
    expect(await previewTransfer(5000)).toEqual({ ok: true, amount: 5000, fee: 50, beneficiaryReceives: 5000 });
  });
});

describe('registerPayoutContact', () => {
  it('registers with SlickPay once and is idempotent on an unchanged RIB', async () => {
    await seedPayableUser({ balance: 0, withBank: false });

    const r1 = await registerPayoutContact({ targetType: 'user', targetId: 'pu1', bankAccount: { ...BANK } });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.bankAccount.ribMasked).toBe('****6789');
    expect(sp.createBeneficiary).toHaveBeenCalledTimes(1);
    expect((await db.read()).users.find((u) => u.id === 'pu1')!.slickpayBeneficiaryUuid).toBe('acc-1');

    // Same RIB again → no second SlickPay call.
    await registerPayoutContact({ targetType: 'user', targetId: 'pu1', bankAccount: { ...BANK, title: 'Renamed' } });
    expect(sp.createBeneficiary).toHaveBeenCalledTimes(1);

    // Changed RIB → re-registers.
    await registerPayoutContact({ targetType: 'user', targetId: 'pu1', bankAccount: { ...BANK, rib: '00700000000000001234' } });
    expect(sp.createBeneficiary).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid RIB', async () => {
    await seedPayableUser({ balance: 0, withBank: false });
    const r = await registerPayoutContact({ targetType: 'user', targetId: 'pu1', bankAccount: { ...BANK, rib: '123' } });
    expect(r).toEqual({ ok: false, reason: 'INVALID_RIB' });
  });
});

describe('getPayableTargets', () => {
  it('lists users with a wallet, masked account + balance', async () => {
    await seedPayableUser({ balance: 7000, withBank: true });
    const targets = await getPayableTargets();
    const u = targets.find((t) => t.id === 'pu1')!;
    expect(u.type).toBe('user');
    expect(u.balance).toBe(7000);
    expect(u.bankAccount?.ribMasked).toBe('****6789');
  });
});

describe('sendTransfer (admin direct)', () => {
  it('reserves + sends a direct transfer, settling the wallet on sent', async () => {
    await seedPayableUser({ balance: 10000, withBank: true });

    const res = await sendTransfer({
      targetType: 'user', targetId: 'pu1', amount: 5000,
      idempotencyKey: 'idem-abc-12345', adminId: 'admin1',
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.finalStatus).toBe('SENT');
    const data = await db.read();
    const reqs = data.withdrawalRequests.filter((r) => r.userId === 'pu1');
    expect(reqs).toHaveLength(1);
    const req = reqs[0]!;
    expect(req.payoutSource).toBe('ADMIN_DIRECT');
    expect(req.status).toBe('APPROVED');
    expect(req.payoutStatus).toBe('SENT');
    // 10000 reserved → 5000; settlement does not debit again.
    expect(data.wallets.find((w) => w.id === 'puw1')!.balance).toBe(5000);
    // On-file uuid was reused — no beneficiary creation.
    expect(sp.createBeneficiary).not.toHaveBeenCalled();
    expect(sp.createDisbursement).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on idempotencyKey — never reserves or sends twice', async () => {
    await seedPayableUser({ balance: 10000, withBank: true });
    const key = 'idem-dup-67890';

    await sendTransfer({ targetType: 'user', targetId: 'pu1', amount: 5000, idempotencyKey: key, adminId: 'admin1' });
    const second = await sendTransfer({ targetType: 'user', targetId: 'pu1', amount: 5000, idempotencyKey: key, adminId: 'admin1' });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.replayed).toBe(true);
    expect((await db.read()).withdrawalRequests.filter((r) => r.userId === 'pu1')).toHaveLength(1);
    expect(sp.createDisbursement).toHaveBeenCalledTimes(1);
  });

  it('surfaces a SlickPay confirmation URL and stays processing', async () => {
    await seedPayableUser({ balance: 10000, withBank: true });
    sp.createDisbursement.mockResolvedValue({ transferId: 'tr-9', redirectUrl: 'https://slick-pay.test/confirm/9', raw: {} });
    sp.status.mockResolvedValue({ completed: 0 });

    const res = await sendTransfer({
      targetType: 'user', targetId: 'pu1', amount: 5000,
      idempotencyKey: 'idem-url-22222', adminId: 'admin1',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.finalStatus).toBe('PROCESSING');
      expect(res.redirectUrl).toBe('https://slick-pay.test/confirm/9');
    }
    const req = (await db.read()).withdrawalRequests.find((r) => r.userId === 'pu1')!;
    expect(req.payoutRedirectUrl).toBe('https://slick-pay.test/confirm/9');
  });

  it('refuses when no bank account is on file', async () => {
    await seedPayableUser({ balance: 10000, withBank: false });
    const res = await sendTransfer({ targetType: 'user', targetId: 'pu1', amount: 5000, idempotencyKey: 'idem-nobank-333', adminId: 'admin1' });
    expect(res).toMatchObject({ ok: false, reason: 'NO_BANK_ACCOUNT' });
    expect(sp.createDisbursement).not.toHaveBeenCalled();
  });

  it('enforces the 500 minimum server-side', async () => {
    await seedPayableUser({ balance: 10000, withBank: true });
    const res = await sendTransfer({ targetType: 'user', targetId: 'pu1', amount: 100, idempotencyKey: 'idem-min-44444', adminId: 'admin1' });
    expect(res).toMatchObject({ ok: false, reason: 'BELOW_MINIMUM' });
  });
});
