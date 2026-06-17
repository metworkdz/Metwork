/**
 * Integration tests for the instant-book, pay-first consultation flow
 * (src/server/consultations/instant-book.ts + pricing.ts).
 *
 * Exercises the real db.update critical section against the in-memory Supabase
 * mock: wallet-funded instant confirm, zero-amount (free credit / full promo)
 * confirm, guest PENDING_PAYMENT settled by the EXISTING guest pay flow, the
 * member wallet-first → SlickPay top-up path (sync + async), and idempotency.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  db,
  type UserRecord,
  type MentorRecord,
  type WalletRecord,
} from '@/server/db/store';
import {
  createInstantBooking,
  settleMemberTopUp,
  isInstantBookEnabled,
} from '@/server/consultations/instant-book';
import { computeConsultationCharge } from '@/server/consultations/pricing';
import { confirmTopUp } from '@/server/wallet/service';
import { initGuestPayment } from '@/server/consultations/guest-payment';

const MENTOR: MentorRecord = {
  id: 'm-instant-1',
  fullName: 'Instant Mentor',
  position: 'Advisor',
  imageUrl: '',
  bio: null,
  linkedinUrl: null,
  consultationFee: 10_000, // per hour
  createdAt: '2026-01-01T00:00:00.000Z',
};

const USER: UserRecord = {
  id: 'u-instant-1',
  email: 'member@example.com',
  passwordHash: 'x',
  fullName: 'Member One',
  phone: '+213500000000',
  city: 'Algiers',
  role: 'ENTREPRENEUR',
  status: 'ACTIVE',
  phoneVerified: true,
  emailVerified: true,
  membershipCode: null,
  avatarUrl: null,
  locale: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as UserRecord;

async function seed(balance: number | null): Promise<void> {
  await db.update((d) => {
    d.mentors = [MENTOR];
    d.users = [USER];
    if (balance !== null) {
      const wallet: WalletRecord = {
        id: 'w-instant-1',
        userId: USER.id,
        balance,
        currency: 'DZD',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      d.wallets = [wallet];
    }
  });
}

function baseInput(over: Partial<Parameters<typeof createInstantBooking>[0]> = {}) {
  return {
    mentorId: MENTOR.id,
    actor: { id: USER.id, membershipDiscountFraction: 0 },
    name: 'Member One',
    email: 'member@example.com',
    phone: '+213500000000',
    message: 'I would like advice on my startup growth strategy.',
    durationMinutes: 60,
    clientReference: 'ref-' + Math.random().toString(36).slice(2, 12),
    appBaseUrl: 'http://localhost:3000',
    ...over,
  };
}

afterEach(() => {
  delete process.env.MOCK_PAYMENT_MODE;
});

describe('computeConsultationCharge (pricing parity)', () => {
  it('pro-rates by duration and applies tier then promo', () => {
    expect(computeConsultationCharge({ feePerHour: 10_000, durationMinutes: 60 }).gross).toBe(10_000);
    expect(computeConsultationCharge({ feePerHour: 10_000, durationMinutes: 30 }).gross).toBe(5_000);
    // 10000 − 20% tier = 8000, then −50% promo = 4000
    const both = computeConsultationCharge({
      feePerHour: 10_000, durationMinutes: 60, membershipDiscountFraction: 0.2, promoDiscountPercent: 50,
    });
    expect(both.gross).toBe(4_000);
    // free credit collapses to 0 regardless of discounts
    expect(computeConsultationCharge({ feePerHour: 10_000, durationMinutes: 60, useFreeCredit: true }).gross).toBe(0);
  });
});

describe('member — wallet funded', () => {
  beforeEach(() => seed(20_000));

  it('debits the wallet and confirms immediately', async () => {
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('confirmed');
    expect(res.booking.status).toBe('CONFIRMED');
    expect(res.booking.transactionId).toBeTruthy();

    const data = await db.read();
    expect(data.wallets[0]!.balance).toBe(10_000);
  });

  it('is idempotent on the same clientReference (single debit)', async () => {
    const input = baseInput();
    const first = await createInstantBooking(input);
    const replay = await createInstantBooking(input);
    expect(first.ok && replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.mode).toBe('confirmed');
    if (replay.mode === 'confirmed') expect(replay.replayed).toBe(true);
    const data = await db.read();
    expect(data.wallets[0]!.balance).toBe(10_000); // not 0
    expect(data.mentorBookings).toHaveLength(1);
  });

  it('rejects when the wallet is frozen', async () => {
    await db.update((d) => { d.wallets[0]!.status = 'FROZEN'; });
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('WALLET_FROZEN');
  });
});

describe('zero-amount → confirm without payment', () => {
  beforeEach(() => seed(0));

  it('confirms a free-credit booking and writes a FREE_QUOTA consultation row', async () => {
    const res = await createInstantBooking(baseInput({ useFreeCredit: true, freeQuotaMonth: '2026-06' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('confirmed');
    expect(res.booking.amountCharged).toBe(0);
    expect(res.booking.chargeType).toBe('FREE_QUOTA');

    const data = await db.read();
    const consult = data.mentorConsultations.find((c) => c.bookingId === res.booking.id);
    expect(consult?.status).toBe('CONFIRMED');
    expect(data.wallets[0]!.balance).toBe(0); // never debited
  });

  it('confirms a 100% promo booking with no charge', async () => {
    const res = await createInstantBooking(baseInput({ promoDiscountPercent: 100 }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mode).toBe('confirmed');
  });
});

describe('guest — PENDING_PAYMENT settled by the existing guest pay flow', () => {
  beforeEach(() => seed(null));

  it('creates a pay-first guest booking that the guest pay flow settles', async () => {
    process.env.MOCK_PAYMENT_MODE = 'sync';
    const res = await createInstantBooking(baseInput({ actor: null }));
    expect(res.ok).toBe(true);
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');
    expect(res.booking.status).toBe('PENDING_PAYMENT');
    expect(res.booking.source).toBe('guest');
    expect(res.amount).toBe(10_000);

    // The EXISTING guest payment flow settles it without any P3-specific change.
    const pay = await initGuestPayment(res.payToken, 'http://localhost:3000');
    expect(pay.ok).toBe(true);

    const data = await db.read();
    const booking = data.mentorBookings.find((b) => b.id === res.booking.id);
    expect(booking?.status).toBe('CONFIRMED');
    expect(booking?.paymentStatus).toBe('PAID');
  });
});

describe('member — wallet-first → SlickPay top-up', () => {
  it('sync top-up settles immediately to confirmed', async () => {
    process.env.MOCK_PAYMENT_MODE = 'sync';
    await seed(3_000); // short of the 10 000 charge
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('confirmed');

    const data = await db.read();
    // 3 000 + 7 000 top-up − 10 000 charge = 0
    expect(data.wallets[0]!.balance).toBe(0);
    expect(data.mentorBookings[0]!.status).toBe('CONFIRMED');
  });

  it('async top-up waits, then settles on verify after the top-up completes', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    await seed(3_000);
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');
    expect(res.booking.status).toBe('PENDING_PAYMENT');
    expect(res.redirectUrl).toBeTruthy();

    // Not settled until the top-up itself completes.
    const before = await settleMemberTopUp(res.payToken);
    expect(before.state).toBe('AWAITING_PAYMENT');

    // Complete the top-up (normally the provider webhook), then verify.
    const data = await db.read();
    const topUpId = data.mentorBookings[0]!.topUpIntentId!;
    await confirmTopUp({ topUpId, providerRef: 'mock-ref', status: 'COMPLETED' });

    const settled = await settleMemberTopUp(res.payToken);
    expect(settled.state).toBe('CONFIRMED');

    const after = await db.read();
    expect(after.wallets[0]!.balance).toBe(0);
    expect(after.mentorBookings[0]!.status).toBe('CONFIRMED');
  });

  it('settleMemberTopUp is idempotent (no double debit)', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    await seed(3_000);
    const res = await createInstantBooking(baseInput());
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('setup failed');
    const data = await db.read();
    await confirmTopUp({ topUpId: data.mentorBookings[0]!.topUpIntentId!, providerRef: 'r', status: 'COMPLETED' });

    await settleMemberTopUp(res.payToken);
    await settleMemberTopUp(res.payToken); // replay
    const after = await db.read();
    expect(after.wallets[0]!.balance).toBe(0); // debited once, not negative
  });
});

describe('feature flag', () => {
  afterEach(() => { delete process.env.CONSULTATION_INSTANT_BOOK; });
  it('reflects CONSULTATION_INSTANT_BOOK', () => {
    delete process.env.CONSULTATION_INSTANT_BOOK;
    expect(isInstantBookEnabled()).toBe(false);
    process.env.CONSULTATION_INSTANT_BOOK = 'true';
    expect(isInstantBookEnabled()).toBe(true);
  });
});
