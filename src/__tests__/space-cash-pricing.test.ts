/**
 * A cash space reservation is priced from the CASH rate.
 *
 * `unitPrice(space, unit, mode)` has always known about `cashPricePer*`, and
 * the card path and the public booking-intent route both passed a mode.
 * `createSpaceBooking` was the ONE caller that did not, so it silently used the
 * ONLINE_FULL default: every cash reservation was quoted and recorded at the
 * online rate. Consultants can only ever book cash (they have no wallet and no
 * card rail), so every consultant space reservation was mispriced.
 *
 * The mismatch had even been papered over in the UI — the consultant portal's
 * price preview deliberately read the BASE rate so it would agree with the
 * buggy server. Both sides are corrected; these tests hold them together.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import { createSpaceBooking, unitPrice } from '@/server/bookings/service';

const INC = 'inc-space-cash';
const MGR = 'mgr-space-cash';
const SPACE = 'space-cash';
const USER = 'user-space-cash';
const MENTOR = 'mentor-space-cash';

/** Online 1 000/h, cash 1 200/h — the host charges a premium for cash. */
const ONLINE_PER_HOUR = 1_000;
const CASH_PER_HOUR = 1_200;
const ONLINE_PER_DAY = 6_000;
const CASH_PER_DAY = 7_000;

/** A Wednesday, well clear of any weekend rule. */
const START = '2030-06-05T09:00:00.000Z';
const END = '2030-06-05T11:00:00.000Z'; // 2 hours

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = [];
    d.wallets = [];
    d.transactions = [];
    d.bookings = [];
    d.spaces = [];
    d.incubators = [];
    d.mentors = [];
    d.deskBookings = [];

    d.incubators.push({
      id: INC, name: 'Cash Incubator', status: 'ACTIVE', managerId: MGR, email: 'c@x.dz',
    } as never);

    d.spaces.push({
      id: SPACE,
      incubatorId: INC,
      incubatorName: 'Cash Incubator',
      name: 'Meeting Room',
      description: 'room',
      category: 'TRAINING_ROOM',
      city: 'Alger',
      imageUrl: null,
      imageUrls: [],
      pricePerHour: ONLINE_PER_HOUR,
      pricePerHalfDay: null,
      pricePerDay: ONLINE_PER_DAY,
      pricePerMonth: null,
      cashPricePerHour: CASH_PER_HOUR,
      cashPricePerHalfDay: null,
      cashPricePerDay: CASH_PER_DAY,
      cashPricePerMonth: null,
      capacity: 10,
      amenities: [],
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 50,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      openingTime: '00:00',
      closingTime: '23:59',
      durationDiscounts: [],
      unavailableDates: [],
      blackouts: [],
      isActive: true,
      isPartnerInNetwork: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    d.users.push({
      id: USER, email: 'u@example.dz', fullName: 'Test User', phone: '+213700000000',
      role: 'ENTREPRENEUR', status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    d.wallets.push({
      id: 'w-space-cash', userId: USER, balance: 100_000, status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    d.mentors.push({
      id: MENTOR, fullName: 'QA Consultant', email: 'm@example.dz', phone: '+213700000001',
      status: 'APPROVED', isApproved: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);
  });
}

beforeEach(async () => {
  await seed();
});

describe('unitPrice', () => {
  it('picks the cash rate only for CASH_DEPOSIT', () => {
    const space = {
      pricePerHour: ONLINE_PER_HOUR, pricePerHalfDay: null,
      pricePerDay: ONLINE_PER_DAY, pricePerMonth: null,
      cashPricePerHour: CASH_PER_HOUR, cashPricePerDay: CASH_PER_DAY,
    };
    expect(unitPrice(space, 'HOUR')).toBe(ONLINE_PER_HOUR);
    expect(unitPrice(space, 'HOUR', 'ONLINE_FULL')).toBe(ONLINE_PER_HOUR);
    expect(unitPrice(space, 'HOUR', 'CASH_DEPOSIT')).toBe(CASH_PER_HOUR);
    expect(unitPrice(space, 'DAY', 'CASH_DEPOSIT')).toBe(CASH_PER_DAY);
  });

  it('falls back to the base rate when no cash rate is set', () => {
    const space = {
      pricePerHour: ONLINE_PER_HOUR, pricePerHalfDay: null,
      pricePerDay: ONLINE_PER_DAY, pricePerMonth: null,
    };
    expect(unitPrice(space, 'HOUR', 'CASH_DEPOSIT')).toBe(ONLINE_PER_HOUR);
  });

  it('never lets a cash rate enable a unit the base price does not offer', () => {
    const space = {
      pricePerHour: null, pricePerHalfDay: null, pricePerDay: ONLINE_PER_DAY, pricePerMonth: null,
      cashPricePerHour: CASH_PER_HOUR,
    };
    expect(unitPrice(space, 'HOUR', 'CASH_DEPOSIT')).toBeNull();
  });
});

describe('createSpaceBooking pricing by surface', () => {
  it('charges the ONLINE rate on a wallet booking', async () => {
    const res = await createSpaceBooking({
      booker: { type: 'user', userId: USER },
      spaceId: SPACE, unit: 'HOUR', startsAt: START, endsAt: END,
      clientReference: 'ref-wallet', paymentMethod: 'wallet',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(ONLINE_PER_HOUR * 2);
  });

  it('records the CASH rate on a cash reservation — THE regression', async () => {
    const res = await createSpaceBooking({
      booker: { type: 'user', userId: USER },
      spaceId: SPACE, unit: 'HOUR', startsAt: START, endsAt: END,
      clientReference: 'ref-cash', paymentMethod: 'manual',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // This used to be ONLINE_PER_HOUR * 2 — the online rate on a cash booking.
    expect(res.booking.totalAmount).toBe(CASH_PER_HOUR * 2);
    expect(res.booking.status).toBe('PENDING_PAYMENT');
    // No money moves on Metwork for a cash reservation: the returned
    // transaction is a deliberate ZERO placeholder that keeps the route shape
    // consistent, and the wallet is untouched. The amount owed lives on the
    // booking, which is the number this test exists to protect.
    expect(res.transaction?.status).toBe('PENDING');
    expect(res.transaction?.amount).toBe(0);
    const wallet = (await db.read()).wallets.find((w) => w.userId === USER)!;
    expect(wallet.balance).toBe(100_000);
  });

  it('prices a CONSULTANT reservation from the cash rate', async () => {
    // Consultants are cash-only, so this path was ALWAYS mispriced.
    const res = await createSpaceBooking({
      booker: {
        type: 'mentor',
        mentorId: MENTOR,
        contact: { fullName: 'QA Consultant', email: 'm@example.dz', phone: '+213700000001' },
      },
      spaceId: SPACE, unit: 'DAY',
      startsAt: '2030-06-05T00:00:00.000Z', endsAt: '2030-06-06T00:00:00.000Z',
      clientReference: 'ref-mentor', paymentMethod: 'manual',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(CASH_PER_DAY);
  });

  it('still uses the base rate when the host set no cash price', async () => {
    await db.update((d) => {
      const s = d.spaces.find((x) => x.id === SPACE)!;
      s.cashPricePerHour = null;
      s.cashPricePerDay = null;
    });
    const res = await createSpaceBooking({
      booker: { type: 'user', userId: USER },
      spaceId: SPACE, unit: 'HOUR', startsAt: START, endsAt: END,
      clientReference: 'ref-nosplit', paymentMethod: 'manual',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(ONLINE_PER_HOUR * 2);
  });
});
