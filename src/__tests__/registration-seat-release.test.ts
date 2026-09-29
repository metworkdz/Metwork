/**
 * Removing a participant frees their seat.
 *
 * The bug: a desk sign-up is a registration AND a CONFIRMED cash booking.
 * Cancelling (then deleting) the registration left the booking CONFIRMED, and
 * attendance counts bookings — a 12/12 program stayed 12/12 after a
 * participant was removed, so nobody else could be added. The same happened
 * the other way round when a booking was cancelled but its registration was
 * not.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: { id: 'mgr', email: 'i@x.dz', role: 'INCUBATOR' } }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});

import { db } from '@/server/db/store';
import { countAttendance } from '@/server/attendance';
import {
  cancelRegistration,
  deleteRegistration,
  incubatorScope,
} from '@/server/registrations/service';
import { addOfflineRegistration } from '@/server/registrations/offline-registration';

const INC = 'inc-seat';
const PROG = '5eed0000-0000-4000-8000-000000000001';
const NOW = '2026-09-01T00:00:00.000Z';
const owner = incubatorScope(INC);

beforeEach(async () => {
  await db.update((d) => {
    d.users = []; d.clients = []; d.events = []; d.mentors = []; d.deskBookings = [];
    d.registrationFormFields = [];
    d.incubators = [{ id: INC, name: 'Hub', status: 'ACTIVE', managerId: 'mgr', email: 'i@x.dz' } as never];
    d.programs = [{
      id: PROG, incubatorId: INC, incubatorName: 'Hub', mentorId: null, title: 'Formation', description: 'x',
      type: 'TRAINING', city: 'Oran', imageUrl: null, price: 6000, seatsTotal: 2,
      deadline: '2030-01-01T12:00:00.000Z', startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-02T12:00:00.000Z',
      acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'formation', createdAt: NOW, updatedAt: NOW,
    } as never];
    d.registrations = [];
    d.bookings = [];
    d.wallets = [];
    d.transactions = [];
  });
});

const seats = async () => countAttendance(await db.read(), 'PROGRAM', PROG);
const addAtDesk = (email: string) => addOfflineRegistration({
  entityType: 'PROGRAM', entityId: PROG, owner, actorId: 'mgr',
  fullName: email, email, phone: '0555000000', answers: [], depositPaid: 6000,
});

describe('a participant added at the desk', () => {
  it('cancelling frees the seat — the cash booking is cancelled with the registration', async () => {
    const a = await addAtDesk('a@x.dz');
    await addAtDesk('b@x.dz');
    expect(await seats()).toBe(2);
    expect(await addAtDesk('c@x.dz')).toMatchObject({ ok: false, reason: 'FULL' });

    if (!a.ok) throw new Error('expected ok');
    expect(await cancelRegistration(a.registration.id, owner)).toMatchObject({ ok: true });
    expect(await seats()).toBe(1);
    const d = await db.read();
    const booking = d.bookings.find((b) => b.id === a.registration.bookingId)!;
    expect(booking).toMatchObject({ status: 'CANCELLED', declineReason: 'REGISTRATION_CANCELLED' });
    // No wallet was touched — cash is handed back off-platform.
    expect(d.transactions).toHaveLength(0);

    // The freed seat can be given to someone else.
    expect(await addAtDesk('c@x.dz')).toMatchObject({ ok: true });
  });

  it('cancel then delete — the reported path — leaves the seat free', async () => {
    const a = await addAtDesk('a@x.dz');
    await addAtDesk('b@x.dz');
    if (!a.ok) throw new Error('expected ok');
    await cancelRegistration(a.registration.id, owner);
    expect(await deleteRegistration(a.registration.id, owner)).toMatchObject({ ok: true });
    expect(await seats()).toBe(1);
  });
});

describe('a participant who paid online', () => {
  beforeEach(async () => {
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-card', itemKind: 'PROGRAM', itemId: PROG, status: 'CONFIRMED', paymentMethod: 'card',
        paymentMode: 'ONLINE_FULL', onlinePaidAmount: 6000, totalAmount: 6000, userId: null,
        clientEmail: 'paid@x.dz', paymentStatus: 'PAID', createdAt: NOW, updatedAt: NOW,
      } as never);
      d.registrations.push({
        id: '5eed0000-0000-4000-8000-0000000000c1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null, userId: null,
        fullName: 'Paid', email: 'paid@x.dz', phone: '0', answers: [], status: 'CONFIRMED', clientId: null,
        bookingId: 'bk-card', createdAt: NOW, updatedAt: NOW,
      } as never);
    });
  });

  it('is not cancelled from the registration — the payment must be reversed by the booking flow', async () => {
    expect(await cancelRegistration('5eed0000-0000-4000-8000-0000000000c1', owner)).toEqual({ ok: false, reason: 'PAID_ONLINE' });
    const d = await db.read();
    expect(d.registrations[0]!.status).toBe('CONFIRMED');
    expect(d.bookings[0]!.status).toBe('CONFIRMED');
  });

  it('the route says why', async () => {
    const { DELETE } = await import('@/app/api/incubator/registrations/route');
    const res = await DELETE(new NextRequest('http://localhost/x', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '5eed0000-0000-4000-8000-0000000000c1' }),
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('PAID_ONLINE');
    expect(body.error.message).toContain('Réservations');
  });

  it('cancelling the booking cancels the registration too, and frees the seat', async () => {
    const { PATCH } = await import('@/app/api/incubator/bookings/[id]/route');
    expect(await seats()).toBe(1);
    const res = await PATCH(new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    }), { params: Promise.resolve({ id: 'bk-card' }) });
    expect(res.status).toBe(200);
    const d = await db.read();
    expect(d.registrations[0]!.status).toBe('CANCELLED');
    expect(await seats()).toBe(0);
  });
});
