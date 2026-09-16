/**
 * Removing a cancelled registration for good.
 *
 * The DELETE verb on the registrations route has always meant CANCEL — it sets
 * the status and keeps the row — so there was no way to actually clear a
 * cancelled entry off the list. This adds one, behind a guard.
 *
 * The guard is the whole point. A CONFIRMED registration is somebody's place:
 * deleting it would erase the person while their seat, their booking and
 * possibly their payment carried on existing. So the rule lives on the server,
 * not in whichever button happens to call it.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import {
  cancelRegistration,
  deleteRegistration,
  incubatorScope,
  mentorScope,
} from '@/server/registrations/service';
import { countAttendance } from '@/server/attendance';

const INC = 'inc-del';
const PROG = 'prog-del';
const NOW = '2026-01-01T00:00:00.000Z';

function registration(over: Record<string, unknown> = {}) {
  return {
    id: 'reg-1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
    userId: null, fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213770112233',
    answers: [{ fieldId: 'f-city', value: 'Oran' }],
    status: 'CONFIRMED', clientId: null, bookingId: null,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  } as never;
}

async function seed(registrations: unknown[] = [], bookings: unknown[] = []): Promise<void> {
  await db.update((d) => {
    d.users = []; d.clients = []; d.events = []; d.mentors = [];
    d.registrationFormFields = [];
    d.incubators = [
      { id: INC, name: 'QA Incubator', status: 'ACTIVE', managerId: 'mgr', email: 'i@x.dz' } as never,
    ];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation', description: 'x', type: 'TRAINING', city: 'Oran',
        imageUrl: null, imageUrls: [], price: 23_000, seatsTotal: 13, seatsTaken: 0,
        deadline: '2030-01-01T12:00:00.000Z',
        startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-03T12:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE'], isActive: true, slug: 'f',
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
    d.registrations = registrations as never[];
    d.bookings = bookings as never[];
  });
}

const owner = () => incubatorScope(INC);
const rows = async () => (await db.read()).registrations;

beforeEach(async () => { await seed(); });

describe('deleting a cancelled registration', () => {
  it('removes the row', async () => {
    await seed([registration({ status: 'CANCELLED' })]);
    const result = await deleteRegistration('reg-1', owner());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted.fullName).toBe('Amina B.');
    expect(await rows()).toHaveLength(0);
  });

  it('works on a row cancelled through the normal flow', async () => {
    // The realistic path: the host cancels from the list, then clears it out.
    await seed([registration()]);
    await cancelRegistration('reg-1', owner());
    expect((await deleteRegistration('reg-1', owner())).ok).toBe(true);
    expect(await rows()).toHaveLength(0);
  });

  it('leaves the other registrations alone', async () => {
    await seed([
      registration({ id: 'reg-1', status: 'CANCELLED' }),
      registration({ id: 'reg-2', email: 'karim@example.dz', status: 'CONFIRMED' }),
    ]);
    await deleteRegistration('reg-1', owner());
    expect((await rows()).map((r) => r.id)).toEqual(['reg-2']);
  });

  it('changes no seat count — a cancelled row never held one', async () => {
    await seed([
      registration({ id: 'reg-1', status: 'CANCELLED' }),
      registration({ id: 'reg-2', email: 'karim@example.dz', status: 'CONFIRMED' }),
    ]);
    const before = countAttendance(await db.read(), 'PROGRAM', PROG);
    await deleteRegistration('reg-1', owner());
    expect(countAttendance(await db.read(), 'PROGRAM', PROG)).toBe(before);
  });
});

describe('what it refuses', () => {
  it('refuses a CONFIRMED registration — that is somebody\'s place', async () => {
    await seed([registration({ status: 'CONFIRMED' })]);
    const result = await deleteRegistration('reg-1', owner());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NOT_CANCELLED');
    expect(await rows()).toHaveLength(1);
  });

  it('refuses a WAITLISTED registration', async () => {
    // They hold no seat either, but they are still waiting on one — removing
    // them silently would drop someone who is expecting to hear back.
    await seed([registration({ status: 'WAITLISTED' })]);
    const result = await deleteRegistration('reg-1', owner());
    expect(result.ok).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('refuses another owner, without revealing the row exists', async () => {
    await seed([registration({ status: 'CANCELLED' })]);
    const asStranger = await deleteRegistration('reg-1', incubatorScope('another-incubator'));
    const asConsultant = await deleteRegistration('reg-1', mentorScope('a-consultant'));

    expect(asStranger.ok).toBe(false);
    if (asStranger.ok) return;
    // NOT_FOUND, never "forbidden": a stranger learns nothing about what exists.
    expect(asStranger.reason).toBe('NOT_FOUND');
    expect(asConsultant.ok).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('reports a missing row as not found', async () => {
    const result = await deleteRegistration('no-such-id', owner());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NOT_FOUND');
  });
});

describe('the money record outlives the registration', () => {
  it('leaves a linked booking untouched', async () => {
    // If money moved, that booking is the proof it did. Deleting somebody's
    // cancelled entry must never quietly erase the payment beside it.
    await seed(
      [registration({ status: 'CANCELLED', bookingId: 'bk-1' })],
      [{
        id: 'bk-1', userId: null, source: 'online', paymentMethod: 'card',
        itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation', vendorName: 'QA',
        city: 'Oran', unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW,
        totalAmount: 23_000, status: 'CONFIRMED', clientReference: 'ref-1',
        clientEmail: 'amina@example.dz', transactionId: null,
        settledAt: NOW, createdAt: NOW, updatedAt: NOW,
      }],
    );

    await deleteRegistration('reg-1', owner());
    const booking = (await db.read()).bookings.find((b) => b.id === 'bk-1');
    expect(booking).toBeDefined();
    expect(booking!.status).toBe('CONFIRMED');
    expect(booking!.totalAmount).toBe(23_000);
  });
});
