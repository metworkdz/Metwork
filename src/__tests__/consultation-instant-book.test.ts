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
import { initDirectPayment } from '@/server/consultations/direct-payment';
import { getMentorWallet } from '@/server/mentors/ledger';
import {
  setBookingMeetingLink,
  completeConsultation,
  resolveSettledStatus,
} from '@/server/consultations/lifecycle';
import { sendConsultationReadyOnce } from '@/server/notifications/consultation-ready';

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
    // Fresh clones so a test mutating the mentor (e.g. meeting defaults) can't
    // leak into the next test via the shared module-level fixture reference.
    d.mentors = [{ ...MENTOR }];
    d.users = [{ ...USER }];
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

describe('computeConsultationCharge (pricing parity, no stacking)', () => {
  it('pro-rates by duration and applies the LARGER of tier vs promo (never both)', () => {
    expect(computeConsultationCharge({ feePerHour: 10_000, durationMinutes: 60 }).gross).toBe(10_000);
    expect(computeConsultationCharge({ feePerHour: 10_000, durationMinutes: 30 }).gross).toBe(5_000);
    // promo (50% = −5000) beats tier (20% = −2000) → gross 5000, promo wins
    const promoWins = computeConsultationCharge({
      feePerHour: 10_000, durationMinutes: 60, membershipDiscountFraction: 0.2, promoDiscountPercent: 50,
    });
    expect(promoWins.gross).toBe(5_000);
    expect(promoWins.appliedSource).toBe('promo');
    // tier (20% = −2000) beats promo (10% = −1000) → gross 8000, tier wins
    const tierWins = computeConsultationCharge({
      feePerHour: 10_000, durationMinutes: 60, membershipDiscountFraction: 0.2, promoDiscountPercent: 10,
    });
    expect(tierWins.gross).toBe(8_000);
    expect(tierWins.appliedSource).toBe('tier');
  });
});

describe('member — wallet funded', () => {
  beforeEach(() => seed(20_000));

  it('debits the wallet and confirms immediately', async () => {
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('confirmed');
    expect(res.booking.paymentStatus).toBe('PAID'); // settled marker
    expect(res.booking.status).toBe('AWAITING_LINK'); // no default link on the fixture
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

  it('confirms a zero-fee (free) mentor booking with no charge', async () => {
    await db.update((d) => { d.mentors[0]!.consultationFee = 0; });
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('confirmed');
    expect(res.booking.amountCharged).toBe(0);
    expect(res.booking.chargeType).toBe('PAID'); // free quota removed — always PAID

    const data = await db.read();
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
    const pay = await initDirectPayment(res.payToken, 'http://localhost:3000');
    expect(pay.ok).toBe(true);

    const data = await db.read();
    const booking = data.mentorBookings.find((b) => b.id === res.booking.id);
    expect(booking?.paymentStatus).toBe('PAID'); // settled
    expect(booking?.status).toBe('AWAITING_LINK'); // no default link on the fixture
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
    expect(data.mentorBookings[0]!.paymentStatus).toBe('PAID');
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
    expect(after.mentorBookings[0]!.paymentStatus).toBe('PAID');
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

describe('mentor earnings credit (P4)', () => {
  it('credits the consultant PENDING balance (net of 30% commission) on a funded confirm', async () => {
    await seed(20_000);
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(8_000); // 10 000 − 20%
    expect(wallet?.availableBalance).toBe(0); // held until COMPLETED (P5)
  });

  it('does not credit a free (zero-fee) mentor booking', async () => {
    await seed(0);
    await db.update((d) => { d.mentors[0]!.consultationFee = 0; });
    await createInstantBooking(baseInput());
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance ?? 0).toBe(0);
  });

  it('credits once on the member top-up path, even across replays', async () => {
    process.env.MOCK_PAYMENT_MODE = 'async';
    await seed(3_000);
    const res = await createInstantBooking(baseInput());
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('setup failed');
    const data = await db.read();
    await confirmTopUp({ topUpId: data.mentorBookings[0]!.topUpIntentId!, providerRef: 'r', status: 'COMPLETED' });
    await settleMemberTopUp(res.payToken);
    await settleMemberTopUp(res.payToken); // replay
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(8_000); // credited once, not 16 000
  });

  it('credits the consultant when a guest pay-first booking settles', async () => {
    process.env.MOCK_PAYMENT_MODE = 'sync';
    await seed(null);
    const res = await createInstantBooking(baseInput({ actor: null }));
    if (!res.ok || res.mode !== 'awaiting_payment') throw new Error('setup failed');
    await initDirectPayment(res.payToken, 'http://localhost:3000');
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(8_000);
  });

  it('does NOT credit a legacy guest booking (no instantBook flag)', async () => {
    process.env.MOCK_PAYMENT_MODE = 'sync';
    await seed(null);
    // A legacy admin-approval guest booking: AWAITING_PAYMENT, no instantBook.
    const token = 'legacy-token-abc123';
    await db.update((d) => {
      d.mentorBookings = [{
        id: 'legacy-1', mentorId: MENTOR.id, userId: null,
        userName: 'G', userEmail: 'g@example.com', userPhone: '+213500000000',
        message: 'legacy consultation request here',
        status: 'AWAITING_PAYMENT', adminNote: null,
        source: 'guest', paymentStatus: 'AWAITING_PAYMENT',
        payToken: token, payTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        guestAmountDue: 10_000, amountCharged: 10_000, guestLocale: 'fr',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }];
    });
    await initDirectPayment(token, 'http://localhost:3000');
    const settled = (await db.read()).mentorBookings.find((b) => b.id === 'legacy-1');
    expect(settled?.status).toBe('CONFIRMED'); // legacy flow still settles
    const wallet = await getMentorWallet(MENTOR.id);
    expect(wallet).toBeNull(); // ...but no mentor credit
  });
});

describe('meeting-link lifecycle (P5a)', () => {
  async function setMentorDefault(mode: 'ONLINE' | 'OFFLINE', link?: string) {
    await db.update((d) => {
      const m = d.mentors.find((x) => x.id === MENTOR.id)!;
      m.defaultMeetingMode = mode;
      m.defaultMeetingLink = link ?? null;
    });
  }

  it('resolveSettledStatus: READY with a default link/address, else AWAITING_LINK', () => {
    expect(resolveSettledStatus({}).status).toBe('AWAITING_LINK');
    // OFFLINE now needs a default address to be deliverable; without one it waits.
    expect(resolveSettledStatus({ defaultMeetingMode: 'OFFLINE' }).status).toBe('AWAITING_LINK');
    const offline = resolveSettledStatus({ defaultMeetingMode: 'OFFLINE', defaultMeetingAddress: '12 Rue Didouche, Alger', defaultMeetingMapsLink: 'https://maps.google.com/x' });
    expect(offline.status).toBe('READY');
    expect(offline.meetingMode).toBe('OFFLINE');
    expect(offline.meetingAddress).toBe('12 Rue Didouche, Alger');
    expect(offline.meetingMapsLink).toBe('https://maps.google.com/x');
    expect(resolveSettledStatus({ defaultMeetingMode: 'ONLINE', defaultMeetingLink: 'https://m.co/x' }).status).toBe('READY');
    expect(resolveSettledStatus({ defaultMeetingMode: 'ONLINE', defaultMeetingLink: '' }).status).toBe('AWAITING_LINK');
  });

  it('settles to READY with the consultant default online link', async () => {
    await seed(20_000);
    await setMentorDefault('ONLINE', 'https://meet.example/room');
    const res = await createInstantBooking(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.status).toBe('READY');
    expect(res.booking.meetingMode).toBe('ONLINE');
    expect(res.booking.meetingLink).toBe('https://meet.example/room');
  });

  it('setBookingMeetingLink moves AWAITING_LINK → READY', async () => {
    await seed(20_000);
    const res = await createInstantBooking(baseInput());
    if (!res.ok) throw new Error('setup failed');
    expect(res.booking.status).toBe('AWAITING_LINK');

    const linked = await setBookingMeetingLink({ bookingId: res.booking.id, mode: 'ONLINE', link: 'https://meet.example/abc' });
    expect(linked.ok).toBe(true);
    if (linked.ok) {
      expect(linked.booking.status).toBe('READY');
      expect(linked.booking.meetingLink).toBe('https://meet.example/abc');
    }

    const noLink = await setBookingMeetingLink({ bookingId: res.booking.id, mode: 'ONLINE' });
    expect(noLink.ok).toBe(false);
    if (!noLink.ok) expect(noLink.reason).toBe('LINK_REQUIRED');
  });

  it('completeConsultation releases PENDING → AVAILABLE and is idempotent', async () => {
    await seed(20_000);
    const res = await createInstantBooking(baseInput());
    if (!res.ok) throw new Error('setup failed');

    // Credited to pending at settlement (10 000 − 20%).
    let wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(8_000);
    expect(wallet?.availableBalance).toBe(0);

    const done = await completeConsultation(res.booking.id);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.booking.status).toBe('COMPLETED');
      expect(done.booking.completedAt).toBeTruthy();
      expect(done.released).toBe(8_000);
    }
    wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.pendingBalance).toBe(0);
    expect(wallet?.availableBalance).toBe(8_000);

    // Replay → no double release.
    const again = await completeConsultation(res.booking.id);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.replayed).toBe(true);
    wallet = await getMentorWallet(MENTOR.id);
    expect(wallet?.availableBalance).toBe(8_000);
  });

  it('completeConsultation refuses a non-instant-book booking', async () => {
    await seed(20_000);
    await db.update((d) => {
      d.mentorBookings = [{
        id: 'legacy-c', mentorId: MENTOR.id, userId: 'u-x',
        userName: 'X', userEmail: 'x@example.com', userPhone: '+213500000000',
        message: 'legacy consultation here', status: 'APPROVED', adminNote: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }];
    });
    const res = await completeConsultation('legacy-c');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_INSTANT_BOOK');
  });
});

describe('ready notification dedup (P5b)', () => {
  async function seedBooking(status: 'READY' | 'AWAITING_LINK'): Promise<string> {
    const id = 'bk-' + Math.random().toString(36).slice(2, 8);
    await db.update((d) => {
      d.mentorBookings = [
        ...(d.mentorBookings ?? []),
        {
          id, mentorId: MENTOR.id, userId: 'u', userName: 'U',
          userEmail: 'u@example.com', userPhone: '+213500000000',
          message: 'a consultation message', status, adminNote: null,
          instantBook: true,
          meetingMode: status === 'READY' ? 'ONLINE' : null,
          meetingLink: status === 'READY' ? 'https://meet.example/x' : null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ];
    });
    return id;
  }

  it('claims linkSentAt once for a READY booking and never re-sends', async () => {
    await seed(null);
    const id = await seedBooking('READY');

    await sendConsultationReadyOnce(id);
    const first = (await db.read()).mentorBookings.find((b) => b.id === id)!.linkSentAt;
    expect(first).toBeTruthy();

    await sendConsultationReadyOnce(id); // replay
    const second = (await db.read()).mentorBookings.find((b) => b.id === id)!.linkSentAt;
    expect(second).toBe(first); // unchanged — sent exactly once
  });

  it('does not notify a booking that is not yet READY', async () => {
    await seed(null);
    const id = await seedBooking('AWAITING_LINK');
    await sendConsultationReadyOnce(id);
    const booking = (await db.read()).mentorBookings.find((b) => b.id === id)!;
    expect(booking.linkSentAt ?? null).toBeNull();
  });
});

describe('instant-book is the only flow (P7b)', () => {
  it('isInstantBookEnabled always returns true (flag retired)', () => {
    expect(isInstantBookEnabled()).toBe(true);
  });
});

describe('manual-mode slot gate (no published agenda)', () => {
  beforeEach(() => seed(50_000));

  const isoDay = (daysAhead: number) => {
    const d = new Date(Date.now() + daysAhead * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('accepts a manual date+time beyond the min-notice window', async () => {
    const res = await createInstantBooking(baseInput({
      consultationDate: isoDay(3), consultationTime: '10:00',
    }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.booking.consultationDate).toBe(isoDay(3));
      expect(res.booking.consultationTime).toBe('10:00');
    }
  });

  it('rejects a manual time inside the 24h min-notice window', async () => {
    // Today at any hour is always < 24h away (and yesterday-proof): use now+1h.
    const soon = new Date(Date.now() + 60 * 60_000);
    const date = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    const time = `${String(soon.getHours()).padStart(2, '0')}:00`;
    const res = await createInstantBooking(baseInput({ consultationDate: date, consultationTime: time }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('SLOT_NOT_BOOKABLE');
  });

  it('rejects an overlapping manual time and a blocked date', async () => {
    const day = isoDay(4);
    const first = await createInstantBooking(baseInput({ consultationDate: day, consultationTime: '14:00' }));
    expect(first.ok).toBe(true);

    // 14:30 overlaps the settled 60-min 14:00 session.
    const overlap = await createInstantBooking(baseInput({ consultationDate: day, consultationTime: '14:30' }));
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.reason).toBe('SLOT_NOT_BOOKABLE');

    // Blocked date → rejected outright.
    const blockedDay = isoDay(5);
    await db.update((d) => {
      const m = d.mentors.find((x) => x.id === MENTOR.id)!;
      m.blockedDates = [blockedDay];
    });
    const blocked = await createInstantBooking(baseInput({ consultationDate: blockedDay, consultationTime: '10:00' }));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('SLOT_NOT_BOOKABLE');
  });
});
