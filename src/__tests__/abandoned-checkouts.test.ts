/**
 * Who filled in the form and never finished paying.
 *
 * A paid registration writes its `RegistrationRecord` at SETTLEMENT, so
 * abandoning the checkout leaves no registration at all — the participants
 * list is empty of those people and the bookings list shows a name and an
 * email with nothing else. Everything they typed, phone number included, was
 * sitting on the dead intent the whole time. This reads it back.
 *
 * The rule that carries the most weight is the exclusion: someone whose first
 * attempt died and whose second one succeeded is a PAYING CUSTOMER. Putting
 * them on a chase list is the one mistake this view could make that would
 * actually cost something, so it gets the most tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import { incubatorScope, mentorScope } from '@/server/registrations/service';
import { listAbandonedCheckouts } from '@/server/registrations/abandoned-checkouts';

const INC = 'inc-abandoned';
const MGR = 'mgr-abandoned';
const PROG = 'prog-abandoned';
const NOW = '2026-09-01T00:00:00.000Z';

/** A dead card intent — the state an abandoned checkout leaves behind. */
function intent(over: Record<string, unknown> = {}) {
  return {
    id: `bk-${Math.random().toString(36).slice(2, 9)}`,
    userId: null,
    source: 'online',
    paymentMethod: 'card',
    itemKind: 'PROGRAM',
    itemId: PROG,
    itemName: 'Formation',
    vendorName: 'QA Incubator',
    city: 'Oran',
    unit: 'DAY',
    quantity: 1,
    startsAt: NOW,
    endsAt: NOW,
    totalAmount: 23_000,
    status: 'PENDING_PAYMENT',
    clientReference: `ref-${Math.random()}`,
    transactionId: null,
    clientName: 'Amina B.',
    clientEmail: 'amina@example.dz',
    clientPhone: '+213770112233',
    registrationDraft: {
      entityType: 'PROGRAM',
      answers: [{ fieldId: 'f-city', value: 'Oran' }],
      locale: 'fr',
    },
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
    ...over,
  } as never;
}

async function seed(bookings: unknown[] = [], registrations: unknown[] = []): Promise<void> {
  await db.update((d) => {
    d.users = []; d.clients = []; d.events = []; d.mentors = [];
    d.registrationFormFields = [];
    d.incubators = [
      { id: INC, name: 'QA Incubator', status: 'ACTIVE', managerId: MGR, email: 'i@x.dz' } as never,
    ];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation', description: 'x', type: 'TRAINING', city: 'Oran',
        imageUrl: null, imageUrls: [], price: 23_000, onlinePrice: 23_000, cashPrice: 25_000,
        seatsTotal: 13, seatsTaken: 0,
        deadline: '2030-01-01T12:00:00.000Z',
        startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-03T12:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'f',
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
    d.bookings = bookings as never[];
    d.registrations = registrations as never[];
  });
}

const forIncubator = () => listAbandonedCheckouts('PROGRAM', PROG, incubatorScope(INC));

beforeEach(async () => { await seed(); });

describe('what an abandoned checkout gives back', () => {
  it('returns the phone number and the answers — the whole point', async () => {
    await seed([intent()]);
    const [person] = await forIncubator();

    expect(person).toBeDefined();
    expect(person!.fullName).toBe('Amina B.');
    expect(person!.email).toBe('amina@example.dz');
    // Neither of these was visible anywhere before.
    expect(person!.phone).toBe('+213770112233');
    expect(person!.answers).toEqual([{ fieldId: 'f-city', value: 'Oran' }]);
    expect(person!.amount).toBe(23_000);
  });

  it('works for checkouts abandoned long before this view existed', async () => {
    // Nothing is backfilled and nothing needs to be: the intent always stored
    // this. An old row reads back exactly like a new one.
    await seed([intent({ createdAt: '2026-01-04T08:00:00.000Z' })]);
    const [person] = await forIncubator();
    expect(person!.phone).toBe('+213770112233');
    expect(person!.lastAttemptAt).toBe('2026-01-04T08:00:00.000Z');
  });

  it('survives a checkout that carried no answers', async () => {
    await seed([intent({ registrationDraft: null })]);
    const [person] = await forIncubator();
    expect(person!.answers).toEqual([]);
    expect(person!.phone).toBe('+213770112233');
  });

  it('lists the most recent attempt first', async () => {
    await seed([
      intent({ clientEmail: 'old@example.dz', createdAt: '2026-09-01T10:00:00.000Z' }),
      intent({ clientEmail: 'new@example.dz', createdAt: '2026-09-14T10:00:00.000Z' }),
    ]);
    expect((await forIncubator()).map((p) => p.email)).toEqual(['new@example.dz', 'old@example.dz']);
  });
});

describe('who must NOT appear', () => {
  it('excludes someone whose next attempt succeeded', async () => {
    // The costly mistake: a dead first try and a paid second one is a customer.
    await seed(
      [intent()],
      [{
        id: 'reg-1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
        userId: null, fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213770112233',
        answers: [], status: 'CONFIRMED', clientId: null, bookingId: 'bk-paid',
        createdAt: NOW, updatedAt: NOW,
      }],
    );
    expect(await forIncubator()).toEqual([]);
  });

  it('matches "already paid" case-insensitively, like attendance does', async () => {
    await seed(
      [intent({ clientEmail: 'Amina@Example.DZ' })],
      [{
        id: 'reg-1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
        userId: null, fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213770112233',
        answers: [], status: 'CONFIRMED', clientId: null, bookingId: 'bk-paid',
        createdAt: NOW, updatedAt: NOW,
      }],
    );
    expect(await forIncubator()).toEqual([]);
  });

  it('still lists someone whose registration was CANCELLED', async () => {
    // A cancelled registration is not a paying customer; they belong on the list.
    await seed(
      [intent()],
      [{
        id: 'reg-1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
        userId: null, fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213770112233',
        answers: [], status: 'CANCELLED', clientId: null, bookingId: null,
        createdAt: NOW, updatedAt: NOW,
      }],
    );
    expect(await forIncubator()).toHaveLength(1);
  });

  it('excludes a CASH reservation — those people have a seat', async () => {
    // Cash-on-site bookings are PENDING_PAYMENT too, but they hold a seat and
    // owe money on the day. They have not abandoned anything.
    await seed([intent({ paymentMethod: 'manual', paymentMode: 'CASH_DEPOSIT' })]);
    expect(await forIncubator()).toEqual([]);
  });

  it('excludes settled and cancelled bookings', async () => {
    await seed([
      intent({ status: 'CONFIRMED', clientEmail: 'paid@example.dz' }),
      intent({ status: 'CANCELLED', clientEmail: 'gone@example.dz' }),
    ]);
    expect(await forIncubator()).toEqual([]);
  });

  it('shows nothing to an owner who does not own the listing', async () => {
    await seed([intent()]);
    expect(await listAbandonedCheckouts('PROGRAM', PROG, incubatorScope('someone-else'))).toEqual([]);
    expect(await listAbandonedCheckouts('PROGRAM', PROG, mentorScope('a-consultant'))).toEqual([]);
  });

  it('ignores intents for a different listing', async () => {
    await seed([intent({ itemId: 'another-program' })]);
    expect(await forIncubator()).toEqual([]);
  });
});

describe('someone who tried more than once', () => {
  it('appears once, with the attempt count', async () => {
    // Two rows five minutes apart is one person whose payment failed — not two
    // leads. Calling them twice is the visible version of this bug.
    await seed([
      intent({ createdAt: '2026-09-15T22:08:00.000Z' }),
      intent({ createdAt: '2026-09-15T22:13:00.000Z' }),
    ]);
    const people = await forIncubator();
    expect(people).toHaveLength(1);
    expect(people[0]!.attempts).toBe(2);
  });

  it('keeps the details from the LATEST attempt', async () => {
    // A retry may carry a corrected phone number, or a lower price after a
    // promo code — the newest attempt is the one worth acting on.
    await seed([
      intent({ createdAt: '2026-09-15T22:08:00.000Z', clientPhone: '0000', totalAmount: 23_000 }),
      intent({
        createdAt: '2026-09-15T22:13:00.000Z',
        clientPhone: '+213770998877',
        totalAmount: 20_700,
        registrationDraft: { entityType: 'PROGRAM', answers: [{ fieldId: 'f-city', value: 'Alger' }], locale: 'fr' },
      }),
    ]);
    const [person] = await forIncubator();
    expect(person!.phone).toBe('+213770998877');
    expect(person!.amount).toBe(20_700);
    expect(person!.answers).toEqual([{ fieldId: 'f-city', value: 'Alger' }]);
    expect(person!.lastAttemptAt).toBe('2026-09-15T22:13:00.000Z');
  });

  it('keeps two different people apart', async () => {
    await seed([
      intent({ clientEmail: 'one@example.dz' }),
      intent({ clientEmail: 'two@example.dz' }),
    ]);
    expect(await forIncubator()).toHaveLength(2);
  });

  it('does not merge people who left no email', async () => {
    // Without an address there is nothing to group on; two blanks are two
    // rows, not one person who tried twice.
    await seed([
      intent({ clientEmail: '', clientName: 'First' }),
      intent({ clientEmail: '', clientName: 'Second' }),
    ]);
    expect(await forIncubator()).toHaveLength(2);
  });
});
