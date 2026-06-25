/**
 * Focused unit coverage for contract VARIABLE substitution — every known token
 * fills, and the amount_paid / amount_due pair reflects the booking's REAL
 * settlement state (not a blanket paid-in-full) across all payment shapes:
 *
 *   • card ONLINE_FULL  — settled vs. still PENDING_PAYMENT
 *   • card CASH_DEPOSIT — deposit paid (AWAITING_CASH) vs. cash collected (PAID)
 *   • wallet / manual   — seat-holding (paid) vs. unpaid intent
 *
 * Pure resolver — no store. Amounts are compared numerically (digits only) so the
 * assertions are robust to locale money formatting.
 */
import { describe, it, expect } from 'vitest';
import { CONTRACT_VARIABLES, resolveContractVariables } from '@/server/contracts/variables';

const SPACE = {
  id: 'sp-1',
  name: 'Training Room A',
  category: 'TRAINING_ROOM',
} as never;

const INCUBATOR = {
  id: 'inc-1',
  name: 'Algiers Incubator',
  address: '12 Rue Didouche Mourad',
  commercialRegNumber: 'RC-16/00-1234567',
  nif: '0987654321098',
  phone: '+213555000000',
  email: 'inc@x.dz',
} as never;

/** A fully-populated base booking; spread to vary the payment shape. */
const baseBooking = {
  id: 'bk-amount-1',
  userId: null,
  source: 'online',
  itemKind: 'SPACE',
  itemId: 'sp-1',
  itemName: 'Training Room A',
  vendorName: 'Algiers Incubator',
  city: 'Algiers',
  unit: 'DAY',
  quantity: 2,
  startsAt: '2026-07-01T09:00:00.000Z',
  endsAt: '2026-07-02T17:00:00.000Z',
  totalAmount: 2000,
  status: 'CONFIRMED',
  clientReference: 'ref-amt',
  clientName: 'Ahmed Benali',
  clientPhone: '+213555123456',
  clientEmail: 'ahmed@x.dz',
  clientIdNumber: 'ID-42',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
};

function resolve(overrides: Record<string, unknown>) {
  return resolveContractVariables({
    booking: { ...baseBooking, ...overrides } as never,
    space: SPACE,
    incubator: INCUBATOR,
    user: null,
    lang: 'fr',
    contractNumber: 'CT-ALGI-AAAA1111',
  });
}

/** Numeric value of a formatted money string ("2 000 DZD" → 2000). */
const num = (s: string) => Number(s.replace(/[^0-9]/g, ''));

describe('resolveContractVariables — amount_paid / amount_due', () => {
  it('card ONLINE_FULL settled → paid in full, nothing due', () => {
    const v = resolve({ paymentMode: 'ONLINE_FULL', paymentStatus: 'PAID', onlinePaidAmount: 2000, status: 'CONFIRMED' });
    expect(num(v.amount_paid)).toBe(2000);
    expect(num(v.amount_due)).toBe(0);
  });

  it('card ONLINE_FULL not yet settled → nothing paid, full total due', () => {
    const v = resolve({ paymentMode: 'ONLINE_FULL', status: 'PENDING_PAYMENT', onlinePaidAmount: 2000 });
    expect(num(v.amount_paid)).toBe(0);
    expect(num(v.amount_due)).toBe(2000);
  });

  it('card CASH_DEPOSIT before cash → deposit paid, balance due', () => {
    const v = resolve({
      paymentMode: 'CASH_DEPOSIT',
      paymentStatus: 'AWAITING_CASH',
      onlinePaidAmount: 1000,
      cashRemainingAmount: 1000,
    });
    expect(num(v.amount_paid)).toBe(1000);
    expect(num(v.amount_due)).toBe(1000);
  });

  it('card CASH_DEPOSIT after cash collected → paid in full', () => {
    const v = resolve({
      paymentMode: 'CASH_DEPOSIT',
      paymentStatus: 'PAID',
      onlinePaidAmount: 1000,
      cashRemainingAmount: 1000,
    });
    expect(num(v.amount_paid)).toBe(2000);
    expect(num(v.amount_due)).toBe(0);
  });

  it('manual / wallet CONFIRMED booking → paid in full', () => {
    const v = resolve({ paymentMethod: 'manual', status: 'CONFIRMED' });
    expect(num(v.amount_paid)).toBe(2000);
    expect(num(v.amount_due)).toBe(0);
  });

  it('manual booking still PENDING_PAYMENT → nothing paid yet', () => {
    const v = resolve({ paymentMethod: 'manual', status: 'PENDING_PAYMENT' });
    expect(num(v.amount_paid)).toBe(0);
    expect(num(v.amount_due)).toBe(2000);
  });
});

describe('resolveContractVariables — full token coverage', () => {
  it('every known token resolves to a string (no undefined leaks)', () => {
    const v = resolve({ paymentMode: 'ONLINE_FULL', paymentStatus: 'PAID', onlinePaidAmount: 2000 }) as Record<string, unknown>;
    for (const { token } of CONTRACT_VARIABLES) {
      expect(typeof v[token], `token ${token} should resolve to a string`).toBe('string');
    }
  });

  it('populates the headline tokens from booking + space + incubator', () => {
    const v = resolve({});
    expect(v.client_name).toBe('Ahmed Benali');
    expect(v.space_name).toBe('Training Room A');
    expect(v.space_category).toBe('Salle de formation'); // fr
    expect(v.incubator_name).toBe('Algiers Incubator');
    expect(v.incubator_cr).toBe('RC-16/00-1234567');
    expect(v.contract_number).toBe('CT-ALGI-AAAA1111');
    expect(num(v.price)).toBe(2000);
  });
});
