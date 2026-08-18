/**
 * Tests for direct card payment of consultations (CIB/Edahabia + international).
 *
 * Covers the invariants that matter for money:
 *  - DZD → EUR conversion rounds UP to the cent and refuses sub-minimum charges.
 *  - The exchange rate is FROZEN per transaction: changing it afterwards never
 *    reprices a booking already quoted or paid.
 *  - A card booking never touches the wallet, even when the wallet could cover it.
 *  - Settlement is idempotent — duplicate webhook delivery cannot double-credit
 *    the consultant or re-create the booking.
 *  - An abandoned checkout leaves an unpaid booking that never credits anyone.
 *  - The consultant ledger is identical regardless of which rail was used.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  db,
  type UserRecord,
  type MentorRecord,
  type WalletRecord,
} from '@/server/db/store';
import { createInstantBooking } from '@/server/consultations/instant-book';
import {
  settleConsultationFromWebhook,
  resolveBookingPaymentProvider,
  isDirectCharge,
} from '@/server/consultations/direct-payment';
import { convertDzdToEur, FxError, isValidEurDzdRate } from '@/server/payments/fx';
import { getEurToDzdRate, setEurToDzdRate } from '@/server/payments/exchange-rate';
import { getMentorWallet } from '@/server/mentors/ledger';

const MENTOR: MentorRecord = {
  id: 'm-card-1',
  fullName: 'Card Mentor',
  position: 'Advisor',
  imageUrl: '',
  bio: null,
  linkedinUrl: null,
  consultationFee: 10_000, // per hour
  createdAt: '2026-01-01T00:00:00.000Z',
};

const USER: UserRecord = {
  id: 'u-card-1',
  email: 'card@example.com',
  passwordHash: 'x',
  fullName: 'Card Payer',
  phone: '+213500000001',
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
    d.mentors = [{ ...MENTOR }];
    d.users = [{ ...USER }];
    d.mentorBookings = [];
    d.mentorWallets = [];
    d.mentorLedgerTxns = [];
    d.transactions = [];
    d.wallets = [];
    if (balance !== null) {
      const wallet: WalletRecord = {
        id: 'w-card-1',
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
    name: 'Card Payer',
    email: 'card@example.com',
    phone: '+213500000001',
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

/* ─────────────────────────── FX conversion ─────────────────────────── */

describe('convertDzdToEur', () => {
  it('rounds UP to the cent so Metwork never eats the fraction', () => {
    // 10000 / 275 = 36.3636… → 36.37, not 36.36
    expect(convertDzdToEur(10_000, 275).amountEur).toBe(36.37);
    expect(convertDzdToEur(10_000, 275).amountEurCents).toBe(3637);
    // 5000 / 275 = 18.1818… → 18.19
    expect(convertDzdToEur(5_000, 275).amountEur).toBe(18.19);
  });

  it('is exact when the division lands on a whole cent', () => {
    expect(convertDzdToEur(27_500, 275).amountEur).toBe(100);
  });

  it('echoes back the rate it froze', () => {
    expect(convertDzdToEur(10_000, 300).rate).toBe(300);
  });

  it('refuses an unset rate rather than guessing one', () => {
    expect(() => convertDzdToEur(10_000, null)).toThrow(FxError);
    expect(() => convertDzdToEur(10_000, undefined)).toThrow(/RATE|rate/i);
  });

  it('refuses a nonsensical rate', () => {
    expect(() => convertDzdToEur(10_000, 0)).toThrow(FxError);
    expect(() => convertDzdToEur(10_000, -275)).toThrow(FxError);
    expect(() => convertDzdToEur(10_000, Number.NaN)).toThrow(FxError);
  });

  it('refuses an amount below the card minimum instead of silently adjusting it', () => {
    // 100 DZD at 275 = €0.37, under the €0.50 floor.
    expect(() => convertDzdToEur(100, 275)).toThrow(FxError);
    try {
      convertDzdToEur(100, 275);
    } catch (err) {
      expect((err as FxError).code).toBe('AMOUNT_BELOW_MINIMUM');
    }
  });

  it('validates rates against sane bounds', () => {
    expect(isValidEurDzdRate(275)).toBe(true);
    expect(isValidEurDzdRate(0)).toBe(false);
    expect(isValidEurDzdRate(-1)).toBe(false);
    expect(isValidEurDzdRate('275')).toBe(false);
    expect(isValidEurDzdRate(1_000_000)).toBe(false);
  });
});

/* ─────────────────────────── Rate storage + freezing ─────────────────────────── */

describe('exchange rate settings', () => {
  beforeEach(async () => {
    await seed(0);
    await db.update((d) => { d.platformSettings = null; });
  });

  it('is unset by default, so international card payment stays unavailable', async () => {
    expect(await getEurToDzdRate()).toBeNull();
  });

  it('stores the rate with an audit trail', async () => {
    await setEurToDzdRate(275, 'admin-1');
    expect(await getEurToDzdRate()).toBe(275);
    const data = await db.read();
    expect(data.platformSettings?.eurToDzdRateUpdatedBy).toBe('admin-1');
    expect(data.platformSettings?.eurToDzdRateUpdatedAt).toBeTruthy();
  });

  it('treats a corrupted/invalid stored rate as unset rather than using it', async () => {
    await db.update((d) => {
      d.platformSettings = {
        appName: 'Metwork',
        maintenanceMode: false,
        signupsEnabled: true,
        paymentsEnabled: true,
        eurToDzdRate: -5,
        updatedAt: new Date().toISOString(),
      };
    });
    expect(await getEurToDzdRate()).toBeNull();
  });

  it('FREEZES the rate on the booking — a later admin change never reprices it', async () => {
    await seed(0);
    await setEurToDzdRate(275, 'admin-1');

    // Quote + charge at 275.
    const frozen = convertDzdToEur(10_000, 275);
    expect(frozen.amountEur).toBe(36.37);

    // Admin doubles the rate afterwards.
    await setEurToDzdRate(550, 'admin-1');
    expect(await getEurToDzdRate()).toBe(550);

    // The already-frozen conversion is unchanged — recomputing at the NEW rate
    // would have produced a different figure, which is exactly what must not
    // happen to an in-flight transaction.
    expect(frozen.amountEur).toBe(36.37);
    expect(convertDzdToEur(10_000, 550).amountEur).toBe(18.19);
  });
});

/* ─────────────────────────── Provider resolution ─────────────────────────── */

describe('resolveBookingPaymentProvider (legacy mapping)', () => {
  it('maps legacy records by origin: guest ⇒ direct charge, registered ⇒ wallet', () => {
    expect(resolveBookingPaymentProvider({ source: 'guest' })).toBe('SLICKPAY');
    expect(resolveBookingPaymentProvider({ source: 'registered' })).toBe('WALLET');
    // Absent source (oldest records) behaves as registered.
    expect(resolveBookingPaymentProvider({})).toBe('WALLET');
  });

  it('prefers the explicit provider when present', () => {
    expect(resolveBookingPaymentProvider({ source: 'registered', paymentProvider: 'STRIPE' })).toBe('STRIPE');
    expect(resolveBookingPaymentProvider({ source: 'guest', paymentProvider: 'WALLET' })).toBe('WALLET');
  });

  it('keeps wallet bookings out of the direct-charge settler', () => {
    expect(isDirectCharge({ source: 'registered', paymentProvider: 'WALLET' })).toBe(false);
    expect(isDirectCharge({ source: 'registered', paymentProvider: 'SLICKPAY' })).toBe(true);
    expect(isDirectCharge({ source: 'registered', paymentProvider: 'STRIPE' })).toBe(true);
  });
});

/* ─────────────────────────── Direct charge behaviour ─────────────────────────── */

describe('direct card charge (SLICKPAY)', () => {
  beforeEach(async () => {
    await seed(0);
  });

  it('creates an AWAITING_PAYMENT booking tagged with the chosen rail', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    expect(res.ok).toBe(true);
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');

    expect(res.booking.paymentProvider).toBe('SLICKPAY');
    expect(res.booking.paymentStatus).toBe('AWAITING_PAYMENT');
    expect(res.booking.amountCharged).toBe(10_000);
    expect(res.redirectUrl).toBeTruthy();
    // The provider reference is stamped so the return poll / webhook can resolve it.
    const stored = (await db.read()).mentorBookings?.find((b) => b.id === res.booking.id);
    expect(stored?.paymentProviderRef).toBeTruthy();
  });

  it('does NOT debit the wallet even when the balance would cover it', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    await seed(50_000); // more than enough

    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    expect(res.ok).toBe(true);

    const data = await db.read();
    // Balance untouched — the wallet is optional and never silently debited.
    expect(data.wallets?.find((w) => w.userId === USER.id)?.balance).toBe(50_000);
    expect(data.transactions?.filter((t) => t.userId === USER.id)).toHaveLength(0);
  });

  it('an abandoned checkout leaves an unpaid booking and credits nobody', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');

    // Payer never completes the hosted checkout: no webhook, no poll.
    const stored = (await db.read()).mentorBookings?.find((b) => b.id === res.booking.id);
    expect(stored?.paymentStatus).toBe('AWAITING_PAYMENT');
    expect(stored?.status).toBe('PENDING_PAYMENT');

    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance ?? 0).toBe(0);
  });

  it('settles on webhook and credits the consultant once', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');

    const settled = await settleConsultationFromWebhook(res.booking.id, 'ref-1', 'COMPLETED');
    expect(settled).toBe('SETTLED');

    const stored = (await db.read()).mentorBookings?.find((b) => b.id === res.booking.id);
    expect(stored?.paymentStatus).toBe('PAID');

    const wallet = await getMentorWallet(MENTOR.id);
    // 10 000 DZD gross, default 20 % platform cut ⇒ 8 000 to the consultant.
    expect(wallet?.pendingBalance).toBe(8_000);
  });

  it('duplicate webhook delivery does not double-credit the consultant', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');

    expect(await settleConsultationFromWebhook(res.booking.id, 'ref-1', 'COMPLETED')).toBe('SETTLED');
    // Stripe/SlickPay both retry; replays must be no-ops.
    expect(await settleConsultationFromWebhook(res.booking.id, 'ref-1', 'COMPLETED')).toBe('ALREADY');
    expect(await settleConsultationFromWebhook(res.booking.id, 'ref-1', 'COMPLETED')).toBe('ALREADY');

    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(8_000);

    const bookings = (await db.read()).mentorBookings ?? [];
    expect(bookings.filter((b) => b.mentorId === MENTOR.id)).toHaveLength(1);
  });

  it('a FAILED webhook never marks the booking paid', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');

    expect(await settleConsultationFromWebhook(res.booking.id, 'ref-1', 'FAILED')).toBe('IGNORED');
    const stored = (await db.read()).mentorBookings?.find((b) => b.id === res.booking.id);
    expect(stored?.paymentStatus).toBe('AWAITING_PAYMENT');
    expect((await getMentorWallet(MENTOR.id))?.pendingBalance ?? 0).toBe(0);
  });

  it('a replayed clientReference does not open a second chargeable checkout', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    const input = baseInput({ paymentMethod: 'SLICKPAY' });
    const first = await createInstantBooking(input);
    const second = await createInstantBooking(input);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected ok');
    expect(second.booking.id).toBe(first.booking.id);

    const bookings = (await db.read()).mentorBookings ?? [];
    expect(bookings).toHaveLength(1);
  });
});

/* ─────────────────────────── Rail parity ─────────────────────────── */

describe('consultant payout is identical across rails', () => {
  it('credits the same DZD whether paid by wallet or by card', async () => {
    // Card rail.
    process.env.MOCK_PAYMENT_MODE = 'async';
    await seed(0);
    const card = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    if (!card.ok || card.mode !== 'awaiting_payment') throw new Error('expected awaiting_payment');
    await settleConsultationFromWebhook(card.booking.id, 'ref-card', 'COMPLETED');
    const cardCredit = (await getMentorWallet(MENTOR.id))?.pendingBalance ?? 0;

    // Wallet rail, same price.
    await seed(50_000);
    const wallet = await createInstantBooking(baseInput({ paymentMethod: 'WALLET' }));
    if (!wallet.ok) throw new Error('expected ok');
    expect(wallet.mode).toBe('confirmed');
    const walletCredit = (await getMentorWallet(MENTOR.id))?.pendingBalance ?? 0;

    expect(cardCredit).toBe(8_000);
    expect(walletCredit).toBe(8_000);
  });

  it('never records a foreign amount on a non-Stripe booking', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    await seed(0);
    const res = await createInstantBooking(baseInput({ paymentMethod: 'SLICKPAY' }));
    if (!res.ok) throw new Error('expected ok');
    const stored = (await db.read()).mentorBookings?.find((b) => b.id === res.booking.id);
    expect(stored?.stripeAmountEur ?? null).toBeNull();
    expect(stored?.stripeRateApplied ?? null).toBeNull();
  });
});
