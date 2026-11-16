/**
 * "No limit on registrations" — the places that used to refuse someone, and the
 * promise that nobody but the host can learn how many people registered.
 *
 * Each gate is run twice: with the limit on (still refuses the extra person — the
 * old behaviour must not change) and with the limit off (never refuses, however
 * many are already registered).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as EmailModule from '@/server/notifications/email';

const MGR = 'user-mgr-gates';
const USER = 'user-buyer-gates';
const currentUser = { id: MGR, email: 'mgr@x.dz', role: 'INCUBATOR', approvalStatus: 'APPROVED' };

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: currentUser });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok), requireApiSession: vi.fn(ok), requireApprovedApiSession: vi.fn(ok) };
});
vi.mock('@/server/auth/session', () => ({ readSession: vi.fn(async () => null) }));
vi.mock('@/server/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  sendResendEmail: async () => true,
}));

import { db } from '@/server/db/store';
import { POST as createManualBooking } from '@/app/api/incubator/manual-bookings/route';
import { GET as eventStatus } from '@/app/api/events/[id]/status/route';
import { GET as programStatus } from '@/app/api/programs/[id]/status/route';
import { createRegistration } from '@/server/registrations/service';
import { applyToProgram, registerForEvent, getEventAttendance, getProgramAttendance } from '@/server/bookings/service';
import { listEvents, findEventById, listEventsByIncubator } from '@/server/bookings/event-catalog';
import { listPrograms, findProgramById, listProgramsByIncubator } from '@/server/bookings/program-catalog';

const INC = 'inc-gates';
const PROG = 'prog-gates';
const EVT = 'evt-gates';
const NOW = '2026-01-01T00:00:00.000Z';
/** A number that cannot appear by accident in a page or a payload. */
const REGISTRANTS = 137;

async function seed(unlimited: boolean, limit: number, held: number): Promise<void> {
  await db.update((d) => {
    d.users = [
      { id: MGR, email: 'mgr@x.dz', fullName: 'Mgr', phone: '+213700000000', role: 'INCUBATOR', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never,
      { id: USER, email: 'buyer@x.dz', fullName: 'Buyer', phone: '+213700000009', role: 'ENTREPRENEUR', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.bookings = []; d.clients = []; d.spaces = []; d.deskBookings = [];
    d.incubators = [{ id: INC, name: 'Gate Hub', status: 'ACTIVE', managerId: MGR, email: 'i@x.dz' } as never];
    d.programs = [{
      id: PROG, incubatorId: INC, incubatorName: 'Gate Hub', mentorId: null,
      title: 'Open Bootcamp', description: 'x', type: 'BOOTCAMP', city: 'Oran',
      imageUrl: null, imageUrls: [], price: 0, onlinePrice: null, cashPrice: null,
      seatsTotal: limit, seatsTaken: 0, ...(unlimited ? { unlimitedCapacity: true } : {}),
      deadline: '2098-12-01T00:00:00.000Z', startDate: '2099-01-01T00:00:00.000Z', endDate: '2099-02-01T00:00:00.000Z',
      acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'open-bootcamp', createdAt: NOW, updatedAt: NOW,
    } as never];
    d.events = [{
      id: EVT, incubatorId: INC, incubatorName: 'Gate Hub', title: 'Demo Day', description: 'x', city: 'Alger',
      imageUrl: null, imageUrls: [], price: 0, onlinePrice: null, cashPrice: null, capacity: limit,
      ...(unlimited ? { unlimitedCapacity: true } : {}), isOnline: true, eventDate: '2099-01-01T10:00:00.000Z',
      acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'demo-day', createdAt: NOW, updatedAt: NOW,
    } as never];
    d.registrations = [];
    for (let i = 0; i < held; i++) {
      for (const [entityType, entityId] of [['PROGRAM', PROG], ['EVENT', EVT]] as const) {
        d.registrations.push({
          id: `r-${entityType}-${i}`, entityType, entityId, incubatorId: INC, mentorId: null, userId: null,
          fullName: `Person ${i}`, email: `p${i}-${entityType}@x.dz`, phone: '+213700000000', answers: [],
          status: 'CONFIRMED', clientId: null, locale: 'fr', createdAt: NOW, updatedAt: NOW,
        } as never);
      }
    }
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function manual(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.');
  return new NextRequest('http://localhost/api/incubator/manual-bookings', {
    method: 'POST',
    body: JSON.stringify({
      itemKind: 'PROGRAM', itemId: PROG, clientName: name, clientPhone: '+213700112233', clientEmail: `${slug}@example.dz`,
      startsAt: '2099-01-01', endsAt: '2099-02-01', unit: 'DAY', quantity: 1, totalAmount: 0,
    }),
    headers: { 'content-type': 'application/json' },
  });
}

const newPerson = { fullName: 'Late Comer', email: 'late@example.dz', phone: '+213700000777', answers: [] };

describe('free public registration', () => {
  it('still waitlists the extra person when the limit is on', async () => {
    await seed(false, 3, 3);
    const { registration } = await createRegistration({ entityType: 'EVENT', entityId: EVT, userId: null, ...newPerson });
    expect(registration.status).toBe('WAITLISTED');
  });
  it(`confirms person #${REGISTRANTS + 1} straight away when there is no limit — never waitlisted`, async () => {
    await seed(true, 3, REGISTRANTS);
    for (const [entityType, entityId] of [['EVENT', EVT], ['PROGRAM', PROG]] as const) {
      const { registration } = await createRegistration({ entityType, entityId, userId: null, ...newPerson });
      expect(registration.status).toBe('CONFIRMED');
    }
  });
});

describe('desk "add participant" and manual bookings', () => {
  it('manual booking is still refused when the limit is on', async () => {
    await seed(false, 2, 2);
    const res = await createManualBooking(manual('Walk In'));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROGRAM_FULL');
  });
  it('manual booking is accepted with no limit, however many are in', async () => {
    await seed(true, 2, REGISTRANTS);
    const res = await createManualBooking(manual('Walk In'));
    expect(res.status).toBe(201);
  });
});

describe('desk "add participant"', () => {
  const add = async (entityType: 'PROGRAM' | 'EVENT') => {
    const { addOfflineRegistration } = await import('@/server/registrations/offline-registration');
    return addOfflineRegistration({
      entityType, entityId: entityType === 'PROGRAM' ? PROG : EVT,
      owner: { kind: 'INCUBATOR', incubatorId: INC }, actorId: MGR,
      fullName: 'Walk In', email: `walk-${entityType}@x.dz`, phone: '0555', answers: [], depositPaid: 0,
    } as never);
  };
  it('refuses a full listing when the limit is on', async () => {
    await seed(false, 2, 2);
    expect(await add('PROGRAM')).toMatchObject({ ok: false, reason: 'FULL' });
    expect(await add('EVENT')).toMatchObject({ ok: false, reason: 'FULL' });
  });
  it('seats the person with no limit, however many are in', async () => {
    await seed(true, 2, REGISTRANTS);
    expect(await add('PROGRAM')).toMatchObject({ ok: true });
    expect(await add('EVENT')).toMatchObject({ ok: true });
  });
});

describe('logged-in apply / register', () => {
  it('apply and register still refuse when the limit is on', async () => {
    await seed(false, 2, 2);
    const a = await applyToProgram({ userId: USER, programId: PROG, clientReference: 'ref-a' });
    expect(a).toMatchObject({ ok: false, reason: 'CAPACITY_EXCEEDED' });
    const e = await registerForEvent({ userId: USER, eventId: EVT, clientReference: 'ref-e' });
    expect(e).toMatchObject({ ok: false, reason: 'CAPACITY_EXCEEDED' });
  });
  it('apply and register succeed with no limit, however many are in', async () => {
    await seed(true, 2, REGISTRANTS);
    const a = await applyToProgram({ userId: USER, programId: PROG, clientReference: 'ref-a' });
    expect(a.ok).toBe(true);
    const e = await registerForEvent({ userId: USER, eventId: EVT, clientReference: 'ref-e' });
    expect(e.ok).toBe(true);
  });
});

describe('what the public can learn', () => {
  beforeEach(async () => { await seed(true, 20, REGISTRANTS); });

  it('the public catalogs carry no number for a listing with no limit', async () => {
    const pub = JSON.stringify({
      events: await listEvents(), event: await findEventById(EVT),
      programs: await listPrograms(), program: await findProgramById(PROG),
    });
    expect(pub).toContain('"unlimitedCapacity":true');
    expect(pub).not.toContain(String(REGISTRANTS));
    const [ev] = await listEvents();
    const [pr] = await listPrograms();
    expect(ev).toMatchObject({ capacity: 0, attendeeCount: 0 });
    expect(pr).toMatchObject({ seatsTotal: 0, seatsTaken: 0 });
  });

  it('the attendance helpers withhold the number', async () => {
    expect(await getEventAttendance(EVT)).toMatchObject({ taken: null, unlimited: true });
    expect(await getProgramAttendance(PROG)).toMatchObject({ taken: null, unlimited: true });
  });

  it('the public status endpoints say "unlimited" and nothing else about numbers', async () => {
    for (const [fn, id] of [[eventStatus, EVT], [programStatus, PROG]] as const) {
      const res = await fn(new Request('http://localhost/x'), ctx(id));
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ unlimited: true });
      expect(text).not.toContain(String(REGISTRANTS));
      expect(text).not.toMatch(/"(taken|capacity)"/);
    }
  });

  it('the host still sees the real count', async () => {
    const [ev] = await listEventsByIncubator(INC);
    const [pr] = await listProgramsByIncubator(INC);
    expect(ev).toMatchObject({ attendeeCount: REGISTRANTS, unlimitedCapacity: true });
    expect(pr).toMatchObject({ seatsTaken: REGISTRANTS, unlimitedCapacity: true });
  });

  it('a limited listing is untouched: the public still sees its numbers', async () => {
    await seed(false, 20, 7);
    const [ev] = await listEvents();
    expect(ev).toMatchObject({ capacity: 20, attendeeCount: 7 });
    const res = await eventStatus(new Request('http://localhost/x'), ctx(EVT));
    expect(await res.json()).toMatchObject({ capacity: 20, taken: 7 });
  });
});
