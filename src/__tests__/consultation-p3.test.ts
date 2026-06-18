/**
 * P3 tests — promo-split subsidy, slot validation/lock at booking, bidirectional
 * reschedule, consultant cancel (members-only refund), and the admin revenue
 * subsidy summary. All against the in-memory store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  type UserRecord,
  type MentorRecord,
  type WalletRecord,
  type MentorBookingRecord,
  type TransactionRecord,
} from '@/server/db/store';
import { createInstantBooking } from '@/server/consultations/instant-book';
import { creditPendingEarning, getMentorWallet, getMentorLedgerView } from '@/server/mentors/ledger';
import { computeMentorPromoSplit } from '@/server/payments/mentor-commission';
import { rescheduleBooking, MAX_RESCHEDULES } from '@/server/consultations/reschedule';
import { cancelByConsultant } from '@/server/consultations/cancel';
import { getConsultationRevenueSummary } from '@/server/mentors/revenue';

const MENTOR: MentorRecord = {
  id: 'm-p3',
  fullName: 'P3 Mentor',
  position: 'Advisor',
  imageUrl: '',
  bio: null,
  linkedinUrl: null,
  consultationFee: 10_000,
  minNoticeHours: 0,
  availabilityTimezone: 'Africa/Algiers',
  weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    slots: [{ start: '09:00', end: '17:00' }],
  })),
  createdAt: '2026-01-01T00:00:00.000Z',
};

const USER: UserRecord = {
  id: 'u-p3',
  email: 'p3@example.com',
  passwordHash: 'x',
  fullName: 'P3 Member',
  phone: '+213500000999',
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

/** A far-future date string for an always-bookable slot. */
const FUTURE = '2030-03-04'; // a Monday
const FUTURE2 = '2030-03-05';

async function seed(balance: number, mentorOver: Partial<MentorRecord> = {}): Promise<void> {
  await db.update((d) => {
    d.mentors = [{ ...MENTOR, ...mentorOver }];
    d.users = [{ ...USER }];
    d.wallets = [{
      id: 'w-p3', userId: USER.id, balance, currency: 'DZD', status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as WalletRecord];
    d.mentorBookings = [];
    d.mentorLedgerTxns = [];
    d.mentorWallets = [];
    d.mentorSlotLocks = [];
    d.transactions = [];
  });
}

function ref() { return 'p3-' + Math.random().toString(36).slice(2, 12); }

describe('computeMentorPromoSplit (subsidize, absolute base)', () => {
  it('pays the consultant on the full base; platform can go negative', () => {
    // base 4000, user paid 2800 (30% promo), 30/70 split
    const s = computeMentorPromoSplit({ basePrice: 4000, collectedAmount: 2800 }, []);
    expect(s.consultantShare).toBe(2800); // round(4000*0.7)
    expect(s.platformShare).toBe(0);      // 2800 - 2800
    // 40% promo → user pays 2400 → platform subsidises 400
    const s2 = computeMentorPromoSplit({ basePrice: 4000, collectedAmount: 2400 }, []);
    expect(s2.consultantShare).toBe(2800);
    expect(s2.platformShare).toBe(-400);
  });
});

describe('creditPendingEarning — promo subsidy', () => {
  beforeEach(() => seed(0));

  it('credits the consultant on the base, recording a signed platform share', async () => {
    await creditPendingEarning({
      mentorId: MENTOR.id,
      bookingId: 'b-sub',
      grossAmount: 2400,          // collected after 40% promo
      consultantShareBase: 4000,  // full base
      promoDiscountAmount: 1600,
    });
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(2800); // full 70% of base

    const { txns } = await getMentorLedgerView(MENTOR.id);
    const commission = txns.find((t) => t.type === 'COMMISSION');
    expect(commission?.metadata.platformShare).toBe(-400);
    expect(commission?.metadata.promoDiscountAmount).toBe(1600);
    expect(commission?.metadata.basePrice).toBe(4000);
  });

  it('back-compat: no base ⇒ splits on the collected gross (30/70)', async () => {
    await creditPendingEarning({ mentorId: MENTOR.id, bookingId: 'b-plain', grossAmount: 10_000 });
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(7_000);
  });

  it('is idempotent per booking', async () => {
    const args = { mentorId: MENTOR.id, bookingId: 'b-i', grossAmount: 2400, consultantShareBase: 4000 };
    await creditPendingEarning(args);
    await creditPendingEarning(args);
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(2800); // not doubled
  });
});

describe('createInstantBooking — full promo vs free quota', () => {
  beforeEach(() => seed(50_000));

  it('a FULL-PROMO (PAID) booking still pays the consultant; platform subsidises', async () => {
    const res = await createInstantBooking({
      mentorId: MENTOR.id,
      actor: { id: USER.id, membershipDiscountFraction: 0 },
      name: 'P3 Member', email: 'p3@example.com', phone: '+213500000999',
      message: 'Need strategic advice on fundraising and growth.',
      durationMinutes: 60,
      promoDiscountPercent: 100,
      appliedPromoCode: null,
      clientReference: ref(),
      appBaseUrl: 'http://localhost:3000',
    });
    expect(res.ok).toBe(true);
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(7_000); // round(10000 * 0.7)
  });

  it('a FREE_QUOTA booking pays the consultant nothing', async () => {
    const res = await createInstantBooking({
      mentorId: MENTOR.id,
      actor: { id: USER.id, membershipDiscountFraction: 0 },
      name: 'P3 Member', email: 'p3@example.com', phone: '+213500000999',
      message: 'Free monthly credit consultation about my MVP.',
      durationMinutes: 60,
      useFreeCredit: true,
      freeQuotaMonth: '2026-06',
      clientReference: ref(),
      appBaseUrl: 'http://localhost:3000',
    });
    expect(res.ok).toBe(true);
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance ?? 0).toBe(0);
  });
});

describe('createInstantBooking — slot validation + lock', () => {
  beforeEach(() => seed(50_000));

  it('rejects a slot not in the availability template', async () => {
    const res = await createInstantBooking({
      mentorId: MENTOR.id,
      actor: { id: USER.id, membershipDiscountFraction: 0 },
      name: 'P3 Member', email: 'p3@example.com', phone: '+213500000999',
      message: 'I would like to book a session at an invalid time slot.',
      durationMinutes: 60,
      consultationDate: FUTURE,
      consultationTime: '08:00', // before the 09:00 template start
      clientReference: ref(),
      appBaseUrl: 'http://localhost:3000',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('SLOT_NOT_BOOKABLE');
  });

  it('accepts a valid slot and a settled booking releases the hold', async () => {
    const res = await createInstantBooking({
      mentorId: MENTOR.id,
      actor: { id: USER.id, membershipDiscountFraction: 0 },
      name: 'P3 Member', email: 'p3@example.com', phone: '+213500000999',
      message: 'Booking a valid session to discuss my growth plan in depth.',
      durationMinutes: 60,
      consultationDate: FUTURE,
      consultationTime: '09:00',
      clientReference: ref(),
      appBaseUrl: 'http://localhost:3000',
    });
    expect(res.ok).toBe(true);
    const data = await db.read();
    expect(data.mentorSlotLocks ?? []).toHaveLength(0); // released after settle
  });
});

/* ─────────────── Reschedule / cancel direct-record helpers ─────────────── */

async function makeSettledBooking(over: Partial<MentorBookingRecord> = {}): Promise<string> {
  const id = 'bk-' + Math.random().toString(36).slice(2, 10);
  await db.update((d) => {
    const payTx: TransactionRecord = {
      id: 'tx-' + id, walletId: 'w-p3', userId: USER.id, type: 'PAYMENT', amount: -10_000,
      balanceAfter: 0, status: 'COMPLETED', description: 'Consultation', reference: 'pay-' + id,
      provider: 'internal', providerTxnId: null, metadata: {}, createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
    };
    d.transactions.push(payTx);
    d.mentorBookings.push({
      id, mentorId: MENTOR.id, userId: USER.id, userName: USER.fullName,
      userEmail: USER.email, userPhone: USER.phone, message: 'Session',
      status: 'READY', adminNote: null, instantBook: true, source: 'registered',
      paymentStatus: 'PAID', amountCharged: 10_000, guestAmountDue: 10_000,
      consultantShareBase: 10_000, transactionId: payTx.id,
      consultationDate: FUTURE, consultationTime: '09:00',
      scheduledAt: '2030-03-04T09:00:00.000Z', durationMinutes: 60,
      guestLocale: 'en', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    } as MentorBookingRecord);
  });
  // Credit the consultant as settlement would have.
  await creditPendingEarning({ mentorId: MENTOR.id, bookingId: id, grossAmount: 10_000, consultantShareBase: 10_000 });
  return id;
}

describe('rescheduleBooking', () => {
  beforeEach(() => seed(0));

  it('moves the slot, increments the count, and caps at MAX_RESCHEDULES', async () => {
    // MAX_RESCHEDULES successful moves (alternating dates so the target is free),
    // then the next one is rejected.
    const id = await makeSettledBooking(); // starts at FUTURE 09:00
    const targets = [FUTURE2, FUTURE, FUTURE2, FUTURE]; // enough alternation
    for (let i = 0; i < MAX_RESCHEDULES; i++) {
      const r = await rescheduleBooking({ bookingId: id, by: 'user', date: targets[i]!, time: '09:00' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.booking.rescheduleCount).toBe(i + 1);
        expect(r.notify).toBe('consultant');
      }
    }
    const over = await rescheduleBooking({ bookingId: id, by: 'consultant', date: targets[MAX_RESCHEDULES]!, time: '09:00' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe('LIMIT_REACHED');
  });

  it('refuses when the current session is inside the notice window', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h away
    const id = await makeSettledBooking({ scheduledAt: soon });
    await db.update((d) => { d.mentors[0]!.minNoticeHours = 24; });
    const r = await rescheduleBooking({ bookingId: id, by: 'user', date: FUTURE, time: '09:00' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TOO_LATE');
  });
});

describe('cancelByConsultant', () => {
  beforeEach(() => seed(0));

  it('refunds the member wallet, reverses the credit, and cancels', async () => {
    const id = await makeSettledBooking();
    const res = await cancelByConsultant({ bookingId: id, reason: 'unavailable' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.refundedAmount).toBe(10_000);

    const data = await db.read();
    const wallet = data.wallets.find((w) => w.userId === USER.id);
    expect(wallet?.balance).toBe(10_000); // refunded
    const booking = data.mentorBookings.find((b) => b.id === id);
    expect(booking?.status).toBe('CANCELLED');
    expect(booking?.refundTransactionId).toBeTruthy();
    const mentorWallet = await getMentorWallet(MENTOR.id);
    expect(mentorWallet?.pendingBalance).toBe(0); // earning reversed
  });

  it('is idempotent (no double refund)', async () => {
    const id = await makeSettledBooking();
    await cancelByConsultant({ bookingId: id });
    const again = await cancelByConsultant({ bookingId: id });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.replayed).toBe(true);
    const data = await db.read();
    expect(data.wallets.find((w) => w.userId === USER.id)?.balance).toBe(10_000); // not 20000
  });

  it('blocks paid GUEST bookings (no internal wallet)', async () => {
    const id = await makeSettledBooking({ source: 'guest', userId: null });
    const res = await cancelByConsultant({ bookingId: id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('GUEST_UNSUPPORTED');
  });
});

describe('getConsultationRevenueSummary', () => {
  beforeEach(() => seed(0));

  it('aggregates promo subsidy and net platform revenue from the ledger', async () => {
    await creditPendingEarning({
      mentorId: MENTOR.id, bookingId: 'rev-1', grossAmount: 2400,
      consultantShareBase: 4000, promoDiscountAmount: 1600,
    });
    await creditPendingEarning({
      mentorId: MENTOR.id, bookingId: 'rev-2', grossAmount: 10_000,
      consultantShareBase: 10_000,
    });
    const s = await getConsultationRevenueSummary();
    expect(s.settledCount).toBe(2);
    expect(s.promoSubsidy).toBe(1600);
    // platform shares: (2400-2800) + (10000-7000) = -400 + 3000 = 2600
    expect(s.netPlatformRevenue).toBe(2600);
    expect(s.totalConsultantEarnings).toBe(2800 + 7000);
  });

  it('excludes cancelled bookings', async () => {
    const id = await makeSettledBooking();
    await cancelByConsultant({ bookingId: id });
    const s = await getConsultationRevenueSummary();
    expect(s.settledCount).toBe(0);
  });
});
