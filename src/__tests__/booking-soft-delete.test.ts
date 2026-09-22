/**
 * Deleting a booking without destroying it.
 *
 * The old DELETE spliced the row out of the store and refused anything that
 * was not a manual booking — so the rows a host actually wants gone (a
 * cancelled reservation, a duplicate attempt from someone who paid on their
 * second try) could not be removed at all, while the one row it did remove
 * took its payment evidence with it.
 *
 * Two rules carry the weight, and they get the most tests:
 *
 *  1. Only a booking holding NO seat may be deleted. Deleting somebody's
 *     confirmed place would erase the person while their seat, registration
 *     and payment carried on existing.
 *  2. An unpaid attempt is deleted SILENTLY. Those people abandoned a
 *     checkout — often paying properly on a second try — and an email about a
 *     booking they never completed is confusing at best. This is the case the
 *     host asked for: one client paid once and left two dead intents behind.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db, type BookingRecord } from '@/server/db/store';
import {
  softDeleteBooking, restoreBooking, deleteNotifiesClient,
} from '@/server/bookings/soft-delete';
import {
  bookingCanBeDeleted, bookingIsDeleted, bookingCountsAsRevenue,
} from '@/server/bookings/status';
import { listAbandonedCheckouts } from '@/server/registrations/abandoned-checkouts';
import { incubatorScope } from '@/server/registrations/service';

const INC = 'inc-del-bk';
const OTHER = 'inc-stranger';
const PROG = 'prog-del-bk';
const NOW = '2026-09-01T00:00:00.000Z';
const owner = { kind: 'INCUBATOR', incubatorId: INC } as const;

function booking(over: Record<string, unknown> = {}) {
  return {
    id: 'bk-1', userId: null, source: 'online', paymentMethod: 'card',
    itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation', vendorName: 'QA',
    city: 'Oran', unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW,
    totalAmount: 23_000, status: 'CANCELLED', clientReference: 'ref-1',
    clientName: 'Amina B.', clientEmail: 'amina@example.dz', transactionId: null,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  } as never;
}

async function seed(bookings: unknown[] = [booking()]): Promise<void> {
  await db.update((d) => {
    d.users = []; d.registrations = []; d.mentors = []; d.deskBookings = [];
    d.registrationFormFields = [];
    d.incubators = [
      { id: INC, name: 'QA', city: 'Oran', status: 'ACTIVE', managerId: 'm', email: 'i@x.dz', createdAt: NOW, updatedAt: NOW } as never,
      { id: OTHER, name: 'Other', city: 'Alger', status: 'ACTIVE', managerId: 'm2', email: 'o@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.programs = [
      { id: PROG, incubatorId: INC, incubatorName: 'QA', mentorId: null, title: 'Formation',
        description: 'x', type: 'TRAINING', city: 'Oran', imageUrl: null, imageUrls: [],
        price: 23_000, seatsTotal: 13, seatsTaken: 0, deadline: '2030-01-01T12:00:00.000Z',
        startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-03T12:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE'], isActive: true, slug: 'f',
        createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.bookings = bookings as never[];
  });
}

const row = async (id = 'bk-1') => (await db.read()).bookings.find((b) => b.id === id);

beforeEach(async () => { await seed(); });

describe('what may be deleted', () => {
  it('deletes a cancelled booking', async () => {
    const res = await softDeleteBooking('bk-1', owner, 'user-1');
    expect(res.ok).toBe(true);
    const after = await row();
    expect(bookingIsDeleted(after!)).toBe(true);
    expect(after!.deletedBy).toBe('user-1');
    // Hidden, not destroyed — the money record is still there.
    expect(after!.totalAmount).toBe(23_000);
  });

  it('deletes an unpaid attempt', async () => {
    await seed([booking({ status: 'PENDING_PAYMENT' })]);
    expect((await softDeleteBooking('bk-1', owner, null)).ok).toBe(true);
  });

  it('refuses a confirmed booking — that is somebody\'s place', async () => {
    await seed([booking({ status: 'CONFIRMED', paymentStatus: 'PAID' })]);
    const res = await softDeleteBooking('bk-1', owner, null);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('HOLDS_SEAT');
    expect(bookingIsDeleted((await row())!)).toBe(false);
  });

  it('refuses a booking that soft-holds a seat while unpaid', async () => {
    // REQUEST-mode: approved but not yet paid. It still reserves the slot.
    await seed([booking({ status: 'APPROVED_UNPAID' })]);
    expect((await softDeleteBooking('bk-1', owner, null)).ok).toBe(false);
  });

  it('refuses twice', async () => {
    await softDeleteBooking('bk-1', owner, null);
    const again = await softDeleteBooking('bk-1', owner, null);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('ALREADY_DELETED');
  });
});

describe('whose booking it is', () => {
  it('refuses another incubator, without revealing the row exists', async () => {
    const res = await softDeleteBooking('bk-1', { kind: 'INCUBATOR', incubatorId: OTHER }, null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // NOT_FOUND, never "forbidden": a stranger probing ids learns nothing.
    expect(res.reason).toBe('NOT_FOUND');
    expect(bookingIsDeleted((await row())!)).toBe(false);
  });

  it('refuses a consultant who does not own the program', async () => {
    const res = await softDeleteBooking('bk-1', { kind: 'MENTOR', mentorId: 'some-consultant' }, null);
    expect(res.ok).toBe(false);
  });

  it('reports a missing booking as not found', async () => {
    const res = await softDeleteBooking('no-such-id', owner, null);
    expect(res.ok).toBe(false);
  });
});

describe('who gets told', () => {
  it('never emails someone about an attempt they abandoned', async () => {
    const b = booking({ status: 'PENDING_PAYMENT' }) as unknown as BookingRecord;
    // Silent even when the host explicitly asked to notify.
    expect(deleteNotifiesClient(b, true)).toBe(false);
    expect(deleteNotifiesClient(b, undefined)).toBe(false);
  });

  it('stays silent by default on a cancelled booking, loud only on request', async () => {
    const b = booking({ status: 'CANCELLED' }) as unknown as BookingRecord;
    expect(deleteNotifiesClient(b, undefined)).toBe(false);
    expect(deleteNotifiesClient(b, true)).toBe(true);
  });
});

describe('what deleting cannot break', () => {
  it('cannot move a financial figure, by construction', async () => {
    // Every status that may be deleted is already excluded from revenue, so
    // hiding one can never change a total. This pins that overlap.
    for (const status of ['CANCELLED', 'REFUNDED', 'PENDING_PAYMENT'] as const) {
      expect(bookingCanBeDeleted({ status })).toBe(true);
      expect(bookingCountsAsRevenue({ status })).toBe(false);
    }
    for (const status of ['CONFIRMED', 'AWAITING_APPROVAL', 'APPROVED_UNPAID'] as const) {
      expect(bookingCanBeDeleted({ status })).toBe(false);
    }
  });

  it('releases any desk hold the booking left behind', async () => {
    await seed([booking({ status: 'CANCELLED' })]);
    await db.update((d) => {
      d.deskBookings = [{ id: 'dk-1', bookingId: 'bk-1', spaceId: 'sp', deskName: 'A1', date: '2026-09-02', status: 'ACTIVE' } as never];
    });
    await softDeleteBooking('bk-1', owner, null);
    expect((await db.read()).deskBookings![0]!.status).toBe('CANCELLED');
  });

  it('takes the row off the abandoned-checkouts list', async () => {
    await seed([booking({
      status: 'PENDING_PAYMENT', paymentMethod: 'card',
      clientPhone: '+213770112233',
      registrationDraft: { entityType: 'PROGRAM', answers: [], locale: 'fr' },
    })]);
    expect(await listAbandonedCheckouts('PROGRAM', PROG, incubatorScope(INC))).toHaveLength(1);

    await softDeleteBooking('bk-1', owner, null);
    expect(await listAbandonedCheckouts('PROGRAM', PROG, incubatorScope(INC))).toEqual([]);
  });
});

describe('restoring', () => {
  it('puts it back', async () => {
    await softDeleteBooking('bk-1', owner, 'user-1');
    const res = await restoreBooking('bk-1', owner);
    expect(res.ok).toBe(true);

    const after = await row();
    expect(bookingIsDeleted(after!)).toBe(false);
    expect(after!.deletedBy).toBeNull();
  });

  it('refuses to restore one that was never deleted', async () => {
    const res = await restoreBooking('bk-1', owner);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NOT_DELETED');
  });

  it('refuses a stranger', async () => {
    await softDeleteBooking('bk-1', owner, null);
    expect((await restoreBooking('bk-1', { kind: 'INCUBATOR', incubatorId: OTHER })).ok).toBe(false);
  });
});
