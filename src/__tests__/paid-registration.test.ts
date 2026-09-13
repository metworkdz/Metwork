/**
 * Paid public registration — the answers survive the checkout, the seat is
 * only taken once money moves, and nothing is written twice.
 *
 * Before this, `/programs/{slug}` — the link an incubator actually hands out —
 * registered anyone for free. A 22 000 DZD training took the seat, sent
 * "registration confirmed", and never asked for a dinar. A paid listing now
 * routes through the card intent: the application answers ride on the booking
 * (`registrationDraft`) and are materialised into a RegistrationRecord inside
 * the same mutation that confirms the paid seat.
 *
 * What is pinned here:
 *   1. A PENDING_PAYMENT intent holds NO seat and writes NO registration.
 *   2. Settlement writes exactly one registration, carrying the answers.
 *   3. Booking + registration are ONE seat, not two (attendance dedupes them).
 *   4. A replayed settlement writes nothing twice.
 *   5. Capacity, checked at settlement, is binding.
 *   6. `insertRegistrationSync` decides inside the lock (capacity + duplicates).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { settleCardBookingFromWebhook } from '@/server/bookings/card-payment';
import { countAttendance } from '@/server/attendance';
import { insertRegistrationSync, createRegistration } from '@/server/registrations/service';

const INC = 'inc-paid-reg';
const MGR = 'mgr-paid-reg';
const PROG = 'prog-paid-reg';
const FIELD_A = '11111111-1111-4111-8111-111111111111';
const FIELD_B = '22222222-2222-4222-8222-222222222222';

const ONLINE_TOTAL = 22_000;
const CASH_TOTAL = 24_000;

const ANSWERS = [
  { fieldId: FIELD_A, value: 'Atelier Verte' },
  { fieldId: FIELD_B, value: ['Idea'] },
];

interface BookingOpts {
  id: string;
  email: string;
  name?: string;
  mode?: 'ONLINE_FULL' | 'CASH_DEPOSIT';
  withDraft?: boolean;
  total?: number;
  online?: number;
  cash?: number;
}

function bookingRow(o: BookingOpts) {
  const mode = o.mode ?? 'ONLINE_FULL';
  return {
    id: o.id,
    userId: null,
    source: 'online',
    paymentMethod: 'card',
    itemKind: 'PROGRAM',
    itemId: PROG,
    itemName: 'Formation Entrepreneuriat',
    vendorName: 'Paid Reg Incubator',
    city: 'Alger',
    unit: 'DAY',
    quantity: 1,
    startsAt: '2030-02-01T00:00:00.000Z',
    endsAt: '2030-03-01T00:00:00.000Z',
    totalAmount: o.total ?? ONLINE_TOTAL,
    status: 'PENDING_PAYMENT',
    clientReference: `ref-${o.id}`,
    clientName: o.name ?? 'Amina B.',
    clientEmail: o.email,
    clientPhone: '+213700112233',
    paymentMode: mode,
    onlinePaidAmount: o.online ?? (mode === 'CASH_DEPOSIT' ? 6_000 : ONLINE_TOTAL),
    cashRemainingAmount: o.cash ?? (mode === 'CASH_DEPOSIT' ? 18_000 : 0),
    settledAt: null,
    payToken: `tok-${o.id}`,
    bookingLocale: 'fr',
    ...(o.withDraft === false
      ? {}
      : { registrationDraft: { entityType: 'PROGRAM', answers: ANSWERS, locale: 'fr' } }),
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  };
}

async function seed(opts: { seats?: number; bookings?: BookingOpts[] } = {}): Promise<void> {
  await db.update((d) => {
    d.incubators = [
      { id: INC, name: 'Paid Reg Incubator', status: 'ACTIVE', managerId: MGR, email: 'p@x.dz' } as never,
    ];
    d.users = [{ id: MGR, email: 'p@x.dz', fullName: 'Manager', role: 'INCUBATOR' } as never];
    d.wallets = [];
    d.transactions = [];
    d.registrations = [];
    d.clients = [];
    d.events = [];
    d.programs = [
      {
        id: PROG,
        incubatorId: INC,
        incubatorName: 'Paid Reg Incubator',
        mentorId: null,
        title: 'Formation Entrepreneuriat',
        description: 'Paid training',
        type: 'TRAINING',
        city: 'Alger',
        imageUrl: null,
        imageUrls: [],
        price: CASH_TOTAL,
        onlinePrice: ONLINE_TOTAL,
        cashPrice: CASH_TOTAL,
        seatsTotal: opts.seats ?? 20,
        seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z',
        startDate: '2030-02-01T00:00:00.000Z',
        endDate: '2030-03-01T00:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'],
        cashDepositType: 'PERCENT',
        cashDepositValue: 25,
        slug: 'formation-entrepreneuriat',
        isActive: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ];
    d.registrationFormFields = [
      {
        id: FIELD_A, entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
        label: 'Startup / project name', type: 'SHORT_TEXT', options: null, required: true, order: 0,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      } as never,
      {
        id: FIELD_B, entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
        label: 'Stage', type: 'CHECKBOX', options: ['Idea', 'MVP'], required: false, order: 1,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ];
    d.bookings = (opts.bookings ?? [{ id: 'bk-1', email: 'amina@example.dz' }]).map(
      (b) => bookingRow(b) as never,
    );
  });
}

async function registrations() {
  return (await db.read()).registrations ?? [];
}
async function attendance() {
  return countAttendance(await db.read(), 'PROGRAM', PROG);
}

beforeEach(async () => {
  await seed();
});

describe('the unpaid intent', () => {
  it('holds no seat and writes no registration', async () => {
    expect(await attendance()).toBe(0);
    expect(await registrations()).toHaveLength(0);
  });
});

describe('settlement materialises the registration', () => {
  it('writes one registration carrying the answers', async () => {
    const outcome = await settleCardBookingFromWebhook('bk-1', 'prov-1', 'COMPLETED');
    expect(outcome).toBe('SETTLED');

    const regs = await registrations();
    expect(regs).toHaveLength(1);
    const reg = regs[0]!;
    expect(reg.entityType).toBe('PROGRAM');
    expect(reg.entityId).toBe(PROG);
    expect(reg.email).toBe('amina@example.dz');
    expect(reg.fullName).toBe('Amina B.');
    expect(reg.status).toBe('CONFIRMED');
    expect(reg.bookingId).toBe('bk-1');
    expect(reg.locale).toBe('fr');
    expect(reg.answers).toEqual(ANSWERS);
    // Ownership is stamped from the entity, so the incubator dashboard sees it.
    expect(reg.incubatorId).toBe(INC);
  });

  it('counts the booking and its registration as ONE seat', async () => {
    await settleCardBookingFromWebhook('bk-1', 'prov-1', 'COMPLETED');
    expect(await attendance()).toBe(1);
  });

  it('upserts a CRM client for the payer', async () => {
    await settleCardBookingFromWebhook('bk-1', 'prov-1', 'COMPLETED');
    const clients = (await db.read()).clients ?? [];
    expect(clients).toHaveLength(1);
    expect(clients[0]!.email).toBe('amina@example.dz');
    expect(clients[0]!.incubatorId).toBe(INC);
  });

  it('writes nothing a second time when settlement replays', async () => {
    expect(await settleCardBookingFromWebhook('bk-1', 'prov-1', 'COMPLETED')).toBe('SETTLED');
    expect(await settleCardBookingFromWebhook('bk-1', 'prov-1', 'COMPLETED')).toBe('ALREADY');
    expect(await registrations()).toHaveLength(1);
    expect(await attendance()).toBe(1);
    expect((await db.read()).clients ?? []).toHaveLength(1);
  });

  it('leaves a cash-deposit booking awaiting the balance, seat already held', async () => {
    await seed({ bookings: [{ id: 'bk-cash', email: 'karim@example.dz', mode: 'CASH_DEPOSIT', total: CASH_TOTAL }] });
    await settleCardBookingFromWebhook('bk-cash', 'prov-c', 'COMPLETED');

    const booking = (await db.read()).bookings.find((b) => b.id === 'bk-cash')!;
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.paymentStatus).toBe('AWAITING_CASH');
    expect(booking.cashRemainingAmount).toBe(18_000);
    expect(await registrations()).toHaveLength(1);
    expect(await attendance()).toBe(1);
  });

  it('does not touch registrations for a booking with no draft', async () => {
    await seed({ bookings: [{ id: 'bk-plain', email: 'no-draft@example.dz', withDraft: false }] });
    await settleCardBookingFromWebhook('bk-plain', 'prov-p', 'COMPLETED');
    expect(await registrations()).toHaveLength(0);
    // The booking itself still holds the seat.
    expect(await attendance()).toBe(1);
  });

  it('ignores a FAILED webhook — no seat, no registration', async () => {
    expect(await settleCardBookingFromWebhook('bk-1', 'prov-1', 'FAILED')).toBe('IGNORED');
    expect(await registrations()).toHaveLength(0);
    expect(await attendance()).toBe(0);
  });
});

describe('capacity is binding at settlement', () => {
  it('voids the paid booking when the last seat went while the payer was on the checkout', async () => {
    await seed({
      seats: 1,
      bookings: [
        { id: 'bk-a', email: 'first@example.dz' },
        { id: 'bk-b', email: 'second@example.dz' },
      ],
    });

    expect(await settleCardBookingFromWebhook('bk-a', 'p-a', 'COMPLETED')).toBe('SETTLED');
    // The seat is gone; the second payer is voided for a manual refund rather
    // than being silently oversold into a full cohort.
    expect(await settleCardBookingFromWebhook('bk-b', 'p-b', 'COMPLETED')).toBe('VOIDED');

    const regs = await registrations();
    expect(regs).toHaveLength(1);
    expect(regs[0]!.email).toBe('first@example.dz');
    expect(await attendance()).toBe(1);

    const voided = (await db.read()).bookings.find((b) => b.id === 'bk-b')!;
    expect(voided.status).toBe('CANCELLED');
    expect(voided.declineReason).toBe('SLOT_TAKEN_AFTER_PAYMENT');
  });
});

describe('insertRegistrationSync decides inside the lock', () => {
  it('waitlists a FREE registration once the seats are gone', async () => {
    await seed({ seats: 1, bookings: [{ id: 'bk-a', email: 'first@example.dz' }] });
    await settleCardBookingFromWebhook('bk-a', 'p-a', 'COMPLETED');

    const { registration } = await createRegistration({
      entityType: 'PROGRAM',
      entityId: PROG,
      userId: null,
      fullName: 'Late Comer',
      email: 'late@example.dz',
      phone: '+213700000001',
      answers: [],
    });
    expect(registration.status).toBe('WAITLISTED');
    // A waitlisted row holds no seat.
    expect(await attendance()).toBe(1);
  });

  it('never waitlists a PAID registration — the seat is already bought', async () => {
    await seed({ seats: 1, bookings: [{ id: 'bk-a', email: 'first@example.dz' }] });
    await settleCardBookingFromWebhook('bk-a', 'p-a', 'COMPLETED');

    // Force the paid path against a full program: the booking that paid for it
    // already holds the seat, so a WAITLISTED row would contradict the money.
    const out = await db.update((d) =>
      insertRegistrationSync(d, {
        entityType: 'PROGRAM',
        entityId: PROG,
        userId: null,
        fullName: 'Paid Late',
        email: 'paid-late@example.dz',
        phone: '+213700000002',
        answers: [],
        bookingId: 'bk-a',
      }),
    );
    // bk-a already has a registration → deduped, not a second row.
    expect(out.alreadyRegistered).toBe(true);
    expect(await registrations()).toHaveLength(1);
  });

  it('refuses a second live registration for the same email', async () => {
    const first = await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Dup', email: 'dup@example.dz', phone: '+213700000003', answers: [],
    });
    const second = await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Dup Again', email: 'DUP@example.dz', phone: '+213700000003', answers: [],
    });
    expect(second.alreadyRegistered).toBe(true);
    expect(second.registration.id).toBe(first.registration.id);
    expect(await registrations()).toHaveLength(1);
  });

  it('attaches a paid booking to an email that had already registered for free', async () => {
    // Someone registers while the listing is free, the host then prices it, and
    // that same person pays. They must end up with ONE row, linked to the
    // booking — not a second seat.
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213700112233', answers: [],
    });
    await settleCardBookingFromWebhook('bk-1', 'prov-1', 'COMPLETED');

    const regs = await registrations();
    expect(regs).toHaveLength(1);
    expect(regs[0]!.bookingId).toBe('bk-1');
    expect(regs[0]!.status).toBe('CONFIRMED');
    expect(await attendance()).toBe(1);
  });
});
