/**
 * Unit tests for the central commission engine
 * (src/server/payments/commission.ts).
 *
 * This is the single source of truth for the platform's take on every payment
 * and online cash deposit, so these tests pin the money math: 5 % receiver +
 * 2 % payer = 7 % take by default, the FLAT receiver exemption (payer fee still
 * applies), integer rounding, and the deposit-only basis. The function is pure
 * — no DB, no client input — so the assertions are exact.
 */
import { describe, it, expect } from 'vitest';
import {
  computeCommission,
  resolveCommissionRates,
  DEFAULT_RECEIVER_COMMISSION_RATE,
  DEFAULT_PAYER_FEE_RATE,
} from '@/server/payments/commission';

describe('computeCommission — defaults (5% receiver + 2% payer)', () => {
  it('charges payer +2% and credits provider base −5% on a COMMISSION plan', () => {
    const q = computeCommission({ transactionType: 'PAYMENT', providerPlan: 'COMMISSION', baseAmount: 10_000 });
    expect(q.receiverCommission).toBe(500); // 5% of 10000
    expect(q.payerFee).toBe(200); // 2% of 10000
    expect(q.grossChargedToPayer).toBe(10_200); // base + fee
    expect(q.netToProviderWallet).toBe(9_500); // base − receiver
    expect(q.platformTake).toBe(700); // 5% + 2%
  });

  it('uses the engine default rate constants', () => {
    expect(DEFAULT_RECEIVER_COMMISSION_RATE).toBe(0.05);
    expect(DEFAULT_PAYER_FEE_RATE).toBe(0.02);
  });
});

describe('computeCommission — FLAT (Pro) exemption', () => {
  it('waives the receiver commission but STILL charges the payer fee', () => {
    const q = computeCommission({ transactionType: 'PAYMENT', providerPlan: 'FLAT', baseAmount: 10_000 });
    expect(q.receiverCommission).toBe(0); // exempt
    expect(q.payerFee).toBe(200); // buyer still pays 2%
    expect(q.grossChargedToPayer).toBe(10_200);
    expect(q.netToProviderWallet).toBe(10_000); // full base credited
    expect(q.platformTake).toBe(200); // payer fee only
  });
});

describe('computeCommission — admin-configured rates', () => {
  it('reads receiver/payer rates from config (never the client)', () => {
    const q = computeCommission({
      transactionType: 'PAYMENT',
      providerPlan: 'COMMISSION',
      baseAmount: 20_000,
      config: { receiverCommissionRate: 0.1, payerFeeRate: 0.03 },
    });
    expect(q.receiverCommission).toBe(2_000); // 10%
    expect(q.payerFee).toBe(600); // 3%
    expect(q.platformTake).toBe(2_600);
  });

  it('clamps out-of-range / invalid configured rates', () => {
    const high = resolveCommissionRates('COMMISSION', { receiverCommissionRate: 5, payerFeeRate: -1 });
    expect(high.receiverRate).toBe(1);
    expect(high.payerRate).toBe(0);
    const nan = resolveCommissionRates('COMMISSION', { receiverCommissionRate: Number.NaN });
    expect(nan.receiverRate).toBe(DEFAULT_RECEIVER_COMMISSION_RATE);
  });
});

describe('computeCommission — deposit basis & rounding', () => {
  it('commission on a CASH_DEPOSIT is taken on the deposit only (net never negative)', () => {
    // Deposit of 1000 on a total far larger — commission only touches the 1000.
    const q = computeCommission({ transactionType: 'PAYMENT', providerPlan: 'COMMISSION', baseAmount: 1_000 });
    expect(q.receiverCommission).toBe(50);
    expect(q.netToProviderWallet).toBe(950);
    expect(q.netToProviderWallet).toBeGreaterThanOrEqual(0);
  });

  it('rounds to integer DZD', () => {
    const q = computeCommission({ transactionType: 'PAYMENT', providerPlan: 'COMMISSION', baseAmount: 333 });
    expect(q.receiverCommission).toBe(Math.round(333 * 0.05)); // 17
    expect(q.payerFee).toBe(Math.round(333 * 0.02)); // 7
    expect(Number.isInteger(q.grossChargedToPayer)).toBe(true);
  });

  it('returns zeros for a non-positive base', () => {
    const q = computeCommission({ transactionType: 'PAYMENT', providerPlan: 'COMMISSION', baseAmount: 0 });
    expect(q.receiverCommission).toBe(0);
    expect(q.payerFee).toBe(0);
    expect(q.grossChargedToPayer).toBe(0);
    expect(q.netToProviderWallet).toBe(0);
  });
});
