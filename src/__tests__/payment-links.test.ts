/**
 * Payment links — money-critical settlement behaviour.
 *
 * Covers the contract from the spec:
 *   - settlement credits the incubator net of fees EXACTLY once (idempotent);
 *   - the central commission engine always runs: a COMMISSION incubator pays the
 *     receiver cut, an ACTIVE-subscription (effective FLAT) incubator pays NO
 *     receiver commission BUT the payer fee still applies;
 *   - a cancelled link blocks payment and is never credited;
 *   - an expired link blocks starting a payment.
 *
 * Settlement is driven through `settlePaymentLinkFromWebhook` (no provider poll)
 * so the tests never touch the network — mirrors webhook-settlement.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import {
  createPaymentLink,
  cancelPaymentLink,
  settlePaymentLinkFromWebhook,
  initPaymentLinkPayment,
} from '@/server/payments/payment-links';

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

/** Seed one incubator. `flat` makes it an ACTIVE-subscription (effective FLAT). */
async function seedIncubator(flat: boolean) {
  await db.update((d) => {
    d.incubators = [
      {
        id: 'inc-1',
        name: 'Inc',
        city: 'Algiers',
        status: 'ACTIVE',
        managerId: 'mgr-1',
        email: 'i@x.com',
        ...(flat
          ? {
              subscriptionCode: 'FLAT',
              subscriptionStatus: 'ACTIVE',
              billingCycle: 'MONTHLY',
              subscriptionPeriodEnd: FUTURE,
            }
          : {}),
      } as never,
    ];
    d.wallets = [];
    d.transactions = [];
    d.paymentLinks = [];
    d.meta = {}; // default platform config → receiver 5 %, payer 2 %
  });
}

function walletBalance(data: Awaited<ReturnType<typeof db.read>>): number {
  return data.wallets.find((w) => w.userId === 'mgr-1')?.balance ?? 0;
}

describe('createPaymentLink', () => {
  beforeEach(() => seedIncubator(false));

  it('creates an ACTIVE link with an unguessable url-safe slug', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1',
      serviceName: 'Consulting',
      amount: 10_000,
      hasExpiry: false,
    });
    expect(link.status).toBe('ACTIVE');
    expect(link.amount).toBe(10_000);
    expect(link.slug).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(link.paidAt).toBeNull();
  });
});

describe('settlePaymentLinkFromWebhook — COMMISSION incubator', () => {
  beforeEach(() => seedIncubator(false));

  it('credits +amount and −5% commission, net exactly once (idempotent)', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1', serviceName: 'Consulting', amount: 10_000, hasExpiry: false,
    });

    const r1 = await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED');
    expect(r1).toBe('SETTLED');

    let data = await db.read();
    const settled = data.paymentLinks.find((l) => l.id === link.id)!;
    expect(settled.status).toBe('PAID');
    expect(settled.paidAt).toBeTruthy();
    expect(settled.commissionAmount).toBe(500); // 5 % of 10 000
    // Net = 10 000 − 500 = 9 500.
    expect(walletBalance(data)).toBe(9_500);
    // Exactly two ledger rows: PAYOUT (+10 000) and COMMISSION (−500).
    const txns = data.transactions.filter((t) => t.userId === 'mgr-1');
    expect(txns.filter((t) => t.type === 'PAYOUT')).toHaveLength(1);
    expect(txns.filter((t) => t.type === 'COMMISSION')).toHaveLength(1);

    // Replay → no double credit.
    const r2 = await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED');
    expect(r2).toBe('ALREADY');
    data = await db.read();
    expect(walletBalance(data)).toBe(9_500);
    expect(data.transactions.filter((t) => t.userId === 'mgr-1')).toHaveLength(2);
  });

  it('freezes the 2% payer fee on the record at settlement', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1', serviceName: 'X', amount: 10_000, hasExpiry: false,
    });
    await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED');
    const settled = (await db.read()).paymentLinks.find((l) => l.id === link.id)!;
    expect(settled.payerFeeAmount).toBe(200); // 2 % of 10 000
    expect(settled.grossChargedToPayer).toBe(10_200);
  });
});

describe('settlePaymentLinkFromWebhook — ACTIVE-subscription (FLAT) incubator', () => {
  beforeEach(() => seedIncubator(true));

  it('charges NO receiver commission but the payer fee still applies', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1', serviceName: 'Consulting', amount: 10_000, hasExpiry: false,
    });
    await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED');

    const data = await db.read();
    const settled = data.paymentLinks.find((l) => l.id === link.id)!;
    expect(settled.commissionAmount).toBe(0);
    // Net = full amount (no receiver commission).
    expect(walletBalance(data)).toBe(10_000);
    // No COMMISSION ledger row written.
    expect(data.transactions.filter((t) => t.type === 'COMMISSION')).toHaveLength(0);
    // Payer fee STILL applies (2 %).
    expect(settled.payerFeeAmount).toBe(200);
    expect(settled.grossChargedToPayer).toBe(10_200);
  });
});

describe('cancel blocks payment', () => {
  beforeEach(() => seedIncubator(false));

  it('cancels an unpaid link and refuses subsequent payment', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1', serviceName: 'X', amount: 5_000, hasExpiry: false,
    });

    const c = await cancelPaymentLink(link.id, 'inc-1');
    expect(c.ok).toBe(true);

    // Public init refuses.
    const init = await initPaymentLinkPayment(
      link.slug, { payerName: 'Jane Doe', payerEmail: 'j@x.com' }, 'http://localhost:3000', 'fr',
    );
    expect(init).toEqual({ ok: false, reason: 'CANCELLED' });

    // A webhook racing in is acknowledged but NEVER credits the wallet.
    const w = await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED');
    expect(w).toBe('IGNORED');
    const data = await db.read();
    expect(data.paymentLinks.find((l) => l.id === link.id)!.status).toBe('CANCELLED');
    expect(walletBalance(data)).toBe(0);
  });

  it('refuses to cancel an already-paid link', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1', serviceName: 'X', amount: 5_000, hasExpiry: false,
    });
    await settlePaymentLinkFromWebhook(link.id, 'ref-1', 'COMPLETED');
    const c = await cancelPaymentLink(link.id, 'inc-1');
    expect(c).toEqual({ ok: false, reason: 'ALREADY_PAID' });
  });
});

describe('expired link blocks payment', () => {
  beforeEach(() => seedIncubator(false));

  it('refuses to start payment on an expired link', async () => {
    const link = await createPaymentLink({
      incubatorId: 'inc-1', serviceName: 'X', amount: 5_000, hasExpiry: true, expiresAt: PAST,
    });
    const init = await initPaymentLinkPayment(
      link.slug, { payerName: 'Jane Doe', payerEmail: 'j@x.com' }, 'http://localhost:3000', 'fr',
    );
    expect(init).toEqual({ ok: false, reason: 'EXPIRED' });
  });
});
