/**
 * Three things a host asked for and could not do.
 *
 * 1. ACCEPT CASH WITHOUT A DEPOSIT. `validateCashDeposit` demanded a deposit
 *    whenever CASH was accepted, and rejected 0 as "must be greater than 0" —
 *    so a host who simply wants people to turn up and pay at the door could not
 *    save the program at all. There was no way to express it.
 *
 * 2. REGISTER FOR SUCH A PROGRAM. Once cash-with-no-deposit is configurable,
 *    the public link has to do something with it: there is nothing to charge
 *    online, so it becomes a reservation that records what is owed.
 *
 * 3. USE A PROMO CODE. The validation endpoint required a session, so a guest
 *    on the public registration link — the surface programs actually sell
 *    through — could not see what a code was worth.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import {
  validateCashDeposit,
  normalizeDepositConfig,
} from '@/server/bookings/listing-payment';
import { createRegistration } from '@/server/registrations/service';
import { countAttendance } from '@/server/attendance';
import { formatSessionHours } from '@/lib/booking-when';

const INC = 'inc-nodep';
const PROG = 'prog-nodep';
const NOW = '2026-01-01T00:00:00.000Z';

/* ══════════════ 1. Cash with no deposit is a valid configuration ══════════════ */

describe('validateCashDeposit', () => {
  it('accepts CASH with NO deposit at all — the whole point', () => {
    expect(validateCashDeposit(['CASH'], null, null)).toBeNull();
    expect(validateCashDeposit(['ONLINE', 'CASH'], undefined, undefined)).toBeNull();
  });

  it('reads a literal 0 as "no deposit" instead of refusing it', () => {
    // This is what a host actually typed, and what used to be rejected.
    expect(validateCashDeposit(['CASH'], 'FIXED', 0)).toBeNull();
    expect(validateCashDeposit(['CASH'], 'PERCENT', 0)).toBeNull();
  });

  it('still rejects a HALF-filled deposit — that is a mistake, not a choice', () => {
    expect(validateCashDeposit(['CASH'], 'FIXED', null)).not.toBeNull();
    expect(validateCashDeposit(['CASH'], null, 5_000)).not.toBeNull();
  });

  it('still rejects a nonsensical deposit', () => {
    expect(validateCashDeposit(['CASH'], 'PERCENT', 101)).not.toBeNull();
    expect(validateCashDeposit(['CASH'], 'PERCENT', -1)).not.toBeNull();
    expect(validateCashDeposit(['CASH'], 'FIXED', -1)).not.toBeNull();
  });

  it('still accepts a real deposit', () => {
    expect(validateCashDeposit(['CASH'], 'PERCENT', 25)).toBeNull();
    expect(validateCashDeposit(['CASH'], 'FIXED', 5_000)).toBeNull();
  });

  it('ignores the deposit entirely when CASH is not accepted', () => {
    expect(validateCashDeposit(['ONLINE'], null, null)).toBeNull();
  });
});

describe('normalizeDepositConfig', () => {
  it('stores a 0 deposit as NO deposit, so every reader asks one question', () => {
    expect(normalizeDepositConfig(['CASH'], 'FIXED', 0)).toEqual({});
    expect(normalizeDepositConfig(['CASH'], null, null)).toEqual({});
  });

  it('keeps a real deposit', () => {
    expect(normalizeDepositConfig(['CASH'], 'PERCENT', 25))
      .toEqual({ cashDepositType: 'PERCENT', cashDepositValue: 25 });
  });

  it('clears the deposit when cash is switched off', () => {
    expect(normalizeDepositConfig(['ONLINE'], 'PERCENT', 25)).toEqual({});
  });
});

/* ══════════ 2. Registering for a paid, cash-only, no-deposit program ══════════ */

async function seed(opts: { deposit?: boolean } = {}): Promise<void> {
  await db.update((d) => {
    d.incubators = [
      { id: INC, name: 'QA Incubator', status: 'ACTIVE', managerId: 'mgr', email: 'i@x.dz' } as never,
    ];
    d.users = []; d.wallets = []; d.transactions = [];
    d.bookings = []; d.registrations = []; d.clients = []; d.events = [];
    d.registrationFormFields = [];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation', description: 'x', type: 'TRAINING', city: 'Alger',
        imageUrl: null, imageUrls: [], price: 24_000, onlinePrice: null, cashPrice: 24_000,
        seatsTotal: 20, seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z',
        startDate: '2030-02-01T11:00:00.000Z', startTime: '18:30', endTime: '21:30',
        endDate: '2030-03-01T11:00:00.000Z',
        acceptedPaymentMethods: ['CASH'],
        ...(opts.deposit ? { cashDepositType: 'PERCENT', cashDepositValue: 25 } : {}),
        isActive: true, slug: 'f', createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
  });
}

beforeEach(async () => {
  await seed();
});

describe('a cash-on-site reservation', () => {
  it('records the seat AND what is owed, without charging anything', async () => {
    const { registration } = await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Karim', email: 'karim@example.dz', phone: '+213700112233',
      answers: [], locale: 'fr',
      cashReservation: {
        listing: {
          id: PROG, title: 'Formation', vendorName: 'QA Incubator', city: 'Alger',
          startsAt: '2030-02-01T18:30:00.000Z', endsAt: '2030-03-01T11:00:00.000Z',
          startsAtHasClockTime: true,
        },
        amountDue: 24_000,
        clientReference: 'cash-prog-nodep-karim@example.dz',
      },
    });

    expect(registration.status).toBe('CONFIRMED');

    const d = await db.read();
    expect(d.bookings).toHaveLength(1);
    const b = d.bookings[0]!;
    expect(b.status).toBe('PENDING_PAYMENT');
    expect(b.paymentMethod).toBe('manual');
    expect(b.totalAmount).toBe(24_000);
    // The whole amount is owed on site; nothing was taken online.
    expect(b.onlinePaidAmount).toBe(0);
    expect(b.cashRemainingAmount).toBe(24_000);
    // No wallet moved.
    expect(d.transactions).toHaveLength(0);

    // The CONFIRMED registration is what holds the seat — the PENDING_PAYMENT
    // booking deliberately does not, so the two must not double-count.
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
  });

  it('does not write a second booking when the same person submits twice', async () => {
    const input = {
      entityType: 'PROGRAM' as const, entityId: PROG, userId: null,
      fullName: 'Karim', email: 'karim@example.dz', phone: '+213700112233',
      answers: [], locale: 'fr',
      cashReservation: {
        listing: {
          id: PROG, title: 'Formation', vendorName: 'QA Incubator', city: 'Alger',
          startsAt: '2030-02-01T18:30:00.000Z', endsAt: '2030-03-01T11:00:00.000Z',
        },
        amountDue: 24_000,
        clientReference: 'cash-prog-nodep-karim@example.dz',
      },
    };
    await createRegistration(input);
    await createRegistration(input);

    const d = await db.read();
    expect(d.registrations).toHaveLength(1);
    expect(d.bookings).toHaveLength(1);
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
  });

  it('writes no booking for a plain FREE registration', async () => {
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Free', email: 'free@example.dz', phone: '+213700112233', answers: [],
    });
    expect((await db.read()).bookings).toHaveLength(0);
  });
});

/* ══════════════════ 3. Session hours ══════════════════ */

describe('formatSessionHours', () => {
  it('renders a range when the host gave both', () => {
    expect(formatSessionHours('18:30', '21:30')).toBe('18:30 – 21:30');
  });

  it('renders the start alone when there is no end', () => {
    expect(formatSessionHours('18:30', null)).toBe('18:30');
  });

  it('says nothing when there is no start — an end alone is useless', () => {
    expect(formatSessionHours(null, '21:30')).toBeNull();
    expect(formatSessionHours(null, null)).toBeNull();
  });

  it('ignores a malformed time rather than printing it', () => {
    expect(formatSessionHours('half past six', '21:30')).toBeNull();
    expect(formatSessionHours('18:30', 'later')).toBe('18:30');
  });
});
