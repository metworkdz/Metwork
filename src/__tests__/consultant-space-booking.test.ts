/**
 * Consultant (mentor) space reservations — identity, cash-only rules and
 * idempotency against the SHARED createSpaceBooking engine.
 *
 * Consultants are a separate population: no UserRecord, no wallet, no
 * membership tier. They reserve a room and pay the space on site, so the only
 * settlement path open to them is `manual` (cash). These tests drive the real
 * db.update critical section and assert that:
 *   - a consultant reservation is attributed via mentorId (userId stays null),
 *   - no wallet or transaction row is ever materialised for them,
 *   - non-cash payment methods and cash-refusing spaces are rejected,
 *   - replay on clientReference is scoped to the individual consultant — two
 *     different consultants sharing a reference must NOT collide.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { createSpaceBooking } from '@/server/bookings/service';

const NOW = '2026-06-01T10:00:00.000Z';
const START = '2026-06-15T09:00:00.000Z';
const END = '2026-06-15T11:00:00.000Z';

const CONTACT = { fullName: 'Dr Amina', email: 'amina@example.com', phone: '+213555111222' };

async function seed(opts: { cash?: boolean } = {}): Promise<void> {
  await db.update((d) => {
    d.users = [];
    d.wallets = [];
    d.transactions = [];
    d.bookings = [];
    d.spaces = [];
    d.incubators = [];
    d.deskBookings = [];

    d.incubators.push({
      id: 'inc-1', name: 'Test Incubator', status: 'ACTIVE', managerId: 'mgr-1',
    } as never);

    d.spaces.push({
      id: 'space-1',
      incubatorId: 'inc-1',
      incubatorName: 'Test Incubator',
      name: 'Training Room A',
      description: 'room',
      category: 'TRAINING_ROOM',
      city: 'Algiers',
      imageUrl: null,
      imageUrls: [],
      pricePerHour: 500,
      pricePerHalfDay: null,
      pricePerDay: 3000,
      pricePerMonth: 40000,
      capacity: 5,
      amenities: [],
      // The cash-refusing variant is what a consultant must be blocked from.
      acceptedPaymentMethods: opts.cash === false ? ['ONLINE'] : ['ONLINE', 'CASH'],
      cashDepositType: null,
      cashDepositValue: null,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      openingTime: '00:00',
      closingTime: '23:59',
      durationDiscounts: [],
      unavailableDates: [],
      blackouts: [],
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  });
}

const baseArgs = {
  spaceId: 'space-1',
  unit: 'HOUR' as const,
  startsAt: START,
  endsAt: END,
  paymentMethod: 'manual' as const,
};

describe('consultant space reservation', () => {
  beforeEach(async () => { await seed(); });

  it('attributes the booking to the mentor, leaves userId null and moves no money', async () => {
    const res = await createSpaceBooking({
      ...baseArgs,
      booker: { type: 'mentor', mentorId: 'mentor-1', contact: CONTACT },
      clientReference: 'ref-consultant-1',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.mentorId).toBe('mentor-1');
    expect(res.booking.userId).toBeNull();
    expect(res.booking.status).toBe('PENDING_PAYMENT');
    expect(res.booking.paymentMethod).toBe('manual');
    // Contact details are snapshotted so the space can reach the consultant.
    expect(res.booking.clientName).toBe(CONTACT.fullName);
    expect(res.booking.clientEmail).toBe(CONTACT.email);
    expect(res.booking.clientPhone).toBe(CONTACT.phone);

    // Critically: no wallet row and no transaction row for a consultant.
    const data = await db.read();
    expect(data.wallets).toHaveLength(0);
    expect(data.transactions).toHaveLength(0);
    expect(data.bookings).toHaveLength(1);
  });

  it('rejects any non-cash payment method', async () => {
    for (const paymentMethod of ['wallet', 'NETWORK_PASS'] as const) {
      const res = await createSpaceBooking({
        ...baseArgs,
        paymentMethod,
        booker: { type: 'mentor', mentorId: 'mentor-1', contact: CONTACT },
        clientReference: `ref-${paymentMethod}`,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('CONSULTANT_CASH_ONLY');
    }
    expect((await db.read()).bookings).toHaveLength(0);
  });

  it('rejects a space that does not accept cash', async () => {
    await seed({ cash: false });
    const res = await createSpaceBooking({
      ...baseArgs,
      booker: { type: 'mentor', mentorId: 'mentor-1', contact: CONTACT },
      clientReference: 'ref-no-cash',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('CASH_NOT_ACCEPTED');
    expect((await db.read()).bookings).toHaveLength(0);
  });

  it('replays the same consultant + clientReference instead of double-booking', async () => {
    const args = {
      ...baseArgs,
      booker: { type: 'mentor' as const, mentorId: 'mentor-1', contact: CONTACT },
      clientReference: 'ref-replay',
    };
    const first = await createSpaceBooking(args);
    const second = await createSpaceBooking(args);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    expect((await db.read()).bookings).toHaveLength(1);
  });

  it('does NOT let two different consultants collide on the same clientReference', async () => {
    // Consultant rows carry userId === null. Keying the replay lookup on userId
    // alone would put every consultant in one shared `null` bucket, and this
    // second call would wrongly return the FIRST consultant's booking.
    const shared = 'ref-shared-by-two-consultants';
    const a = await createSpaceBooking({
      ...baseArgs,
      booker: { type: 'mentor', mentorId: 'mentor-a', contact: CONTACT },
      clientReference: shared,
    });
    const b = await createSpaceBooking({
      ...baseArgs,
      booker: { type: 'mentor', mentorId: 'mentor-b', contact: CONTACT },
      clientReference: shared,
    });

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.replayed).toBe(false);
    expect(b.booking.id).not.toBe(a.booking.id);
    expect(b.booking.mentorId).toBe('mentor-b');
    expect((await db.read()).bookings).toHaveLength(2);
  });

  it('keeps a consultant reservation separate from a platform user reservation', async () => {
    await db.update((d) => {
      d.users.push({
        id: 'user-1', email: 'u@example.com', passwordHash: 'h', fullName: 'Test User',
        phone: '+213500000000', city: 'Algiers', role: 'ENTREPRENEUR', status: 'ACTIVE',
        phoneVerified: true, emailVerified: true, membershipCode: null, avatarUrl: null,
        locale: 'en', createdAt: NOW, updatedAt: NOW,
      } as never);
    });

    const shared = 'ref-shared-across-populations';
    const mentor = await createSpaceBooking({
      ...baseArgs,
      booker: { type: 'mentor', mentorId: 'mentor-1', contact: CONTACT },
      clientReference: shared,
    });
    const user = await createSpaceBooking({
      ...baseArgs,
      booker: { type: 'user', userId: 'user-1' },
      clientReference: shared,
    });

    expect(mentor.ok && user.ok).toBe(true);
    if (!mentor.ok || !user.ok) return;
    expect(user.replayed).toBe(false);
    expect(user.booking.id).not.toBe(mentor.booking.id);
    expect(user.booking.userId).toBe('user-1');
    expect(user.booking.mentorId ?? null).toBeNull();
  });
});
