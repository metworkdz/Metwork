/**
 * "No limit on registrations" — the rule and the routes that save it.
 *
 * What must hold:
 *   • the rule: no flag = limited (every older record), flag = never full
 *   • creating: a limit is required unless the host chose no limit; a listing with
 *     no limit still remembers a number to restore
 *   • saving: switching the limit off keeps the number, switching it back on
 *     restores it, and switching OFF confirms everyone on the waitlist (and tells
 *     them) because there is nothing left to wait for
 *   • the same behaviour on all three surfaces: incubator events, incubator
 *     programs, consultant programs
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as EmailModule from '@/server/notifications/email';
import { db } from '@/server/db/store';
import {
  DEFAULT_EVENT_CAPACITY,
  DEFAULT_PROGRAM_SEATS,
  fillPercent,
  hasRoom,
  isFull,
  isUnlimited,
  seatLimit,
  seatsLeft,
} from '@/lib/seat-limit';

const sent: Array<{ to: string; subject: string }> = [];
vi.mock('@/server/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  sendResendEmail: async (o: { to: string; subject: string }) => { sent.push(o); return true; },
}));

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'u-inc', email: 'inc@x.dz', role: 'INCUBATOR', approvalStatus: 'APPROVED' } });
  return { requireApiRole: vi.fn(ok), requireApprovedApiRole: vi.fn(ok), requireApiSession: vi.fn(ok) };
});
vi.mock('@/server/mentors/access', () => ({ requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'm1' })) }));

import { POST as eventCreate } from '@/app/api/incubator/events/route';
import { PATCH as eventPatch } from '@/app/api/incubator/events/[id]/route';
import { POST as programCreate } from '@/app/api/incubator/programs/route';
import { PATCH as programPatch } from '@/app/api/incubator/programs/[id]/route';
import { POST as cProgramCreate } from '@/app/api/consultant/programs/route';
import { PATCH as cProgramPatch } from '@/app/api/consultant/programs/[id]/route';

describe('the rule', () => {
  it('treats a record with no flag as limited — every record that existed before this feature', () => {
    expect(isUnlimited({ capacity: 50 })).toBe(false);
    expect(seatLimit({ capacity: 50 })).toBe(50);
    expect(seatLimit({ seatsTotal: 20 })).toBe(20);
    expect(isUnlimited({ capacity: 50, unlimitedCapacity: false })).toBe(false);
    expect(isUnlimited({ capacity: 50, unlimitedCapacity: null })).toBe(false);
  });
  it('has room until the limit is reached, then not', () => {
    expect(hasRoom({ capacity: 3 }, 2)).toBe(true);
    expect(hasRoom({ capacity: 3 }, 3)).toBe(false);
    expect(isFull({ seatsTotal: 3 }, 3)).toBe(true);
    expect(seatsLeft({ capacity: 3 }, 1)).toBe(2);
    expect(seatsLeft({ capacity: 3 }, 9)).toBe(0);
    expect(fillPercent({ capacity: 4 }, 1)).toBe(25);
  });
  it('never fills with no limit, whatever the number, and has no number to show', () => {
    const l = { capacity: 3, unlimitedCapacity: true };
    expect(seatLimit(l)).toBeNull();
    expect(hasRoom(l, 0)).toBe(true);
    expect(hasRoom(l, 10_000)).toBe(true);
    expect(isFull(l, 10_000)).toBe(false);
    expect(seatsLeft(l, 10_000)).toBeNull();
    expect(fillPercent(l, 10_000)).toBeNull();
  });
  it('a limit of zero is full (a legacy record with no places never silently becomes open)', () => {
    expect(hasRoom({ capacity: 0 }, 0)).toBe(false);
    expect(hasRoom({}, 0)).toBe(false);
  });
});

/* ───────────────────────── Routes ───────────────────────── */

const INC = 'inc-seat';
const NOW = '2026-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T10:00:00.000Z';

beforeEach(async () => {
  sent.length = 0;
  await db.update((d) => {
    d.incubators = [{ id: INC, managerId: 'u-inc', name: 'Hub', status: 'ACTIVE', email: 'inc@x.dz' } as never];
    d.mentors = [{ id: 'm1', fullName: 'Amina B.', email: 'amina@x.dz', status: 'APPROVED' } as never];
    d.users = [];
    d.events = []; d.programs = []; d.registrations = []; d.bookings = []; d.clients = [];
  });
});

const post = (url: string, body: unknown, method = 'POST') =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const eventBody = (over: Record<string, unknown> = {}) => ({
  title: 'Startup Demo Day', description: 'A day of pitches for startups', city: 'Alger', price: 0,
  isOnline: true, eventDate: FUTURE, acceptedPaymentMethods: ['ONLINE'], ...over,
});
const programBody = (over: Record<string, unknown> = {}) => ({
  title: 'Open Bootcamp', description: 'An open bootcamp for founders', type: 'BOOTCAMP', city: 'Oran', price: 0,
  acceptedPaymentMethods: ['ONLINE'],
  deadline: '2098-12-01T00:00:00.000Z', startDate: '2099-01-01T00:00:00.000Z', endDate: '2099-02-01T00:00:00.000Z', ...over,
});

async function waitlisted(type: 'EVENT' | 'PROGRAM', id: string, n: number) {
  await db.update((d) => {
    for (let i = 0; i < n; i++) {
      d.registrations.push({
        id: `w${i}`, entityType: type, entityId: id, incubatorId: INC, mentorId: null, userId: null,
        fullName: `Waiting ${i}`, email: `w${i}@x.dz`, phone: '+213700000000', answers: [], status: 'WAITLISTED',
        clientId: null, locale: 'fr', createdAt: NOW, updatedAt: NOW,
      } as never);
    }
    d.registrations.push({
      id: 'c0', entityType: type, entityId: id, incubatorId: INC, mentorId: null, userId: null,
      fullName: 'Cancelled', email: 'c0@x.dz', phone: '+213700000000', answers: [], status: 'CANCELLED',
      clientId: null, createdAt: NOW, updatedAt: NOW,
    } as never);
  });
}

describe('events', () => {
  it('creates a limited event as before', async () => {
    const res = await eventCreate(post('/api/incubator/events', eventBody({ capacity: 30 })));
    expect(res.status).toBe(201);
    const ev = (await db.read()).events[0]!;
    expect(ev.capacity).toBe(30);
    expect(ev.unlimitedCapacity).toBeUndefined();
  });
  it('requires a limit unless the host chose no limit', async () => {
    const res = await eventCreate(post('/api/incubator/events', eventBody()));
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.fieldErrors.capacity).toBeTruthy();
    expect((await db.read()).events).toHaveLength(0);
  });
  it('creates an event with no limit and no number, remembering a default to restore', async () => {
    const res = await eventCreate(post('/api/incubator/events', eventBody({ unlimitedCapacity: true })));
    expect(res.status).toBe(201);
    const ev = (await db.read()).events[0]!;
    expect(ev.unlimitedCapacity).toBe(true);
    expect(ev.capacity).toBe(DEFAULT_EVENT_CAPACITY);
  });
  it('keeps a number given alongside no limit', async () => {
    await eventCreate(post('/api/incubator/events', eventBody({ unlimitedCapacity: true, capacity: 120 })));
    expect((await db.read()).events[0]!.capacity).toBe(120);
  });
  it('switches the limit off and back on without losing the number', async () => {
    await eventCreate(post('/api/incubator/events', eventBody({ capacity: 40 })));
    const id = (await db.read()).events[0]!.id;

    await eventPatch(post(`/x`, { unlimitedCapacity: true }, 'PATCH'), ctx(id));
    let ev = (await db.read()).events[0]!;
    expect(ev.unlimitedCapacity).toBe(true);
    expect(ev.capacity).toBe(40);

    await eventPatch(post(`/x`, { unlimitedCapacity: false }, 'PATCH'), ctx(id));
    ev = (await db.read()).events[0]!;
    expect(ev.unlimitedCapacity).toBeUndefined();
    expect(ev.capacity).toBe(40);
  });
  it('an unrelated edit leaves the setting alone', async () => {
    await eventCreate(post('/api/incubator/events', eventBody({ unlimitedCapacity: true })));
    const id = (await db.read()).events[0]!.id;
    await eventPatch(post('/x', { title: 'Renamed event' }, 'PATCH'), ctx(id));
    expect((await db.read()).events[0]!.unlimitedCapacity).toBe(true);
  });
  it('switching OFF the limit confirms the waitlist and emails each person', async () => {
    await eventCreate(post('/api/incubator/events', eventBody({ capacity: 1 })));
    const id = (await db.read()).events[0]!.id;
    await waitlisted('EVENT', id, 3);

    const res = await eventPatch(post('/x', { unlimitedCapacity: true }, 'PATCH'), ctx(id));
    expect((await res.json()).confirmedFromWaitlist).toBe(3);

    const regs = (await db.read()).registrations;
    expect(regs.filter((r) => r.status === 'CONFIRMED')).toHaveLength(3);
    expect(regs.find((r) => r.id === 'c0')!.status).toBe('CANCELLED'); // a cancelled registration stays cancelled
    expect(sent.map((m) => m.to).sort()).toEqual(['w0@x.dz', 'w1@x.dz', 'w2@x.dz']);
  });
  it('saving the same setting again confirms nobody twice', async () => {
    await eventCreate(post('/api/incubator/events', eventBody({ capacity: 1 })));
    const id = (await db.read()).events[0]!.id;
    await waitlisted('EVENT', id, 2);
    await eventPatch(post('/x', { unlimitedCapacity: true }, 'PATCH'), ctx(id));
    sent.length = 0;
    const again = await eventPatch(post('/x', { unlimitedCapacity: true }, 'PATCH'), ctx(id));
    expect((await again.json()).confirmedFromWaitlist).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('switching the limit back on does not unconfirm anyone', async () => {
    await eventCreate(post('/api/incubator/events', eventBody({ unlimitedCapacity: true, capacity: 1 })));
    const id = (await db.read()).events[0]!.id;
    await waitlisted('EVENT', id, 0);
    await db.update((d) => { d.registrations.push({ id: 'k', entityType: 'EVENT', entityId: id, status: 'CONFIRMED', createdAt: NOW, updatedAt: NOW } as never); });
    await eventPatch(post('/x', { unlimitedCapacity: false }, 'PATCH'), ctx(id));
    expect((await db.read()).registrations.find((r) => r.id === 'k')!.status).toBe('CONFIRMED');
  });
});

describe.each([
  ['incubator programs', programCreate, programPatch, '/api/incubator/programs'],
  ['consultant programs', cProgramCreate, cProgramPatch, '/api/consultant/programs'],
] as const)('%s', (_name, create, patch, url) => {
  it('requires a number of seats unless the host chose no limit', async () => {
    const res = await create(post(url, programBody()));
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.fieldErrors.seatsTotal).toBeTruthy();
  });
  it('creates a program with no limit, remembering a default number of seats', async () => {
    const res = await create(post(url, programBody({ unlimitedCapacity: true })));
    expect(res.status).toBe(201);
    const p = (await db.read()).programs[0]!;
    expect(p.unlimitedCapacity).toBe(true);
    expect(p.seatsTotal).toBe(DEFAULT_PROGRAM_SEATS);
  });
  it('still creates a limited program as before', async () => {
    expect((await create(post(url, programBody({ seatsTotal: 15 })))).status).toBe(201);
    const p = (await db.read()).programs[0]!;
    expect(p.seatsTotal).toBe(15);
    expect(p.unlimitedCapacity).toBeUndefined();
  });
  it('switches off and on keeping the seats, and confirms the waitlist when switched off', async () => {
    await create(post(url, programBody({ seatsTotal: 10 })));
    const id = (await db.read()).programs[0]!.id;
    await waitlisted('PROGRAM', id, 2);
    // the consultant route scopes by mentor
    if (url.includes('consultant')) await db.update((d) => { d.programs[0]!.mentorId = 'm1'; });

    const res = await patch(post('/x', { unlimitedCapacity: true }, 'PATCH'), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).confirmedFromWaitlist).toBe(2);
    let p = (await db.read()).programs[0]!;
    expect(p.unlimitedCapacity).toBe(true);
    expect(p.seatsTotal).toBe(10);
    expect(sent).toHaveLength(2);

    await patch(post('/x', { unlimitedCapacity: false }, 'PATCH'), ctx(id));
    p = (await db.read()).programs[0]!;
    expect(p.unlimitedCapacity).toBeUndefined();
    expect(p.seatsTotal).toBe(10);
  });
});
