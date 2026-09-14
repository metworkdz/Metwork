/**
 * The manual-booking overbooking guard counts the same seats everyone else does.
 *
 * It used to tally BOOKINGS only:
 *
 *   d.bookings.filter(b => b.itemKind === 'PROGRAM' && b.itemId === id
 *                          && b.status !== 'CANCELLED' && b.status !== 'REFUNDED')
 *
 * which was wrong in both directions at once. Every seat held by a public
 * REGISTRATION was invisible to it, so the desk could keep adding people to a
 * room the public page already showed as full. And it counted PENDING_PAYMENT
 * intents, which deliberately hold no seat, so it could also refuse a seat
 * that was genuinely free.
 *
 * `countAttendance` is the single source of truth the public badge, the card
 * checkout and the desk path all read. This pins the manual route to it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const MGR = 'user-mgr-cap';
const currentUser = { id: MGR, email: 'mgr@x.dz', role: 'INCUBATOR', approvalStatus: 'APPROVED' };

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: currentUser });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

import { db } from '@/server/db/store';
import { POST as createManualBooking } from '@/app/api/incubator/manual-bookings/route';
import { createRegistration } from '@/server/registrations/service';

const INC = 'inc-cap';
const PROG = 'prog-cap';
const NOW = '2026-01-01T00:00:00.000Z';

async function seed(seatsTotal: number): Promise<void> {
  await db.update((d) => {
    d.users = [{ id: MGR, email: 'mgr@x.dz', fullName: 'Mgr', phone: '+213700000000',
                 role: 'INCUBATOR', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never];
    d.bookings = []; d.registrations = []; d.clients = []; d.spaces = []; d.deskBookings = [];
    d.incubators = [
      { id: INC, name: 'QA Incubator', status: 'ACTIVE', managerId: MGR, email: 'i@x.dz' } as never,
    ];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation', description: 'x', type: 'TRAINING', city: 'Oran',
        imageUrl: null, imageUrls: [], price: 25_000, onlinePrice: null, cashPrice: null,
        seatsTotal, seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z',
        startDate: '2030-02-01T00:00:00.000Z', endDate: '2030-02-03T00:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'f',
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
  });
}

function request(clientName: string) {
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '.');
  return new NextRequest('http://localhost/api/incubator/manual-bookings', {
    method: 'POST',
    body: JSON.stringify({
      itemKind: 'PROGRAM', itemId: PROG,
      clientName, clientPhone: '+213700112233', clientEmail: `${slug}@example.dz`,
      startsAt: '2030-02-01', endsAt: '2030-02-03',
      unit: 'DAY', quantity: 1, totalAmount: 25_000,
    }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('manual booking capacity', () => {
  beforeEach(async () => { await seed(1); });

  it('refuses a seat already held by a PUBLIC REGISTRATION — the regression', async () => {
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Public Person', email: 'public@example.dz', phone: '+213700000001', answers: [],
    });

    const res = await createManualBooking(request('Walk In'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('PROGRAM_FULL');
    // And nothing was written on the way to refusing.
    expect((await db.read()).bookings).toHaveLength(0);
  });

  it('allows a seat when the only other row is an UNPAID intent, which holds none', async () => {
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-pending', userId: null, source: 'online', paymentMethod: 'card',
        itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation', vendorName: 'QA', city: 'Oran',
        unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW, totalAmount: 25_000,
        status: 'PENDING_PAYMENT', clientReference: 'ref-pending', transactionId: null,
        clientEmail: 'pending@example.dz', createdAt: NOW, updatedAt: NOW,
      } as never);
    });

    const res = await createManualBooking(request('Walk In'));
    expect(res.status).toBe(201);
  });

  it('still refuses once the room is genuinely full', async () => {
    expect((await createManualBooking(request('First'))).status).toBe(201);
    const second = await createManualBooking(request('Second'));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('PROGRAM_FULL');
  });
});
