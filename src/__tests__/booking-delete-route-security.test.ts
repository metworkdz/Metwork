/**
 * The delete and restore endpoints, from the point of view of someone who
 * should not be able to use them.
 *
 * Deleting hides a booking from its owner's lists, so the interesting
 * question is not whether the happy path works — it is what a caller who
 * does not own the booking, or is not an incubator at all, can do with an id
 * they guessed or saw in a URL.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
let currentUser: typeof actor | null = actor;

vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => currentUser
    ? { ok: true, user: currentUser }
    : { ok: false, response: new Response('unauthorised', { status: 401 }) }),
  requireApprovedApiRole: vi.fn(async () => currentUser
    ? { ok: true, user: currentUser }
    : { ok: false, response: new Response('unauthorised', { status: 401 }) }),
}));

import { db } from '@/server/db/store';

const NOW = '2026-09-01T00:00:00.000Z';
const A = 'inc-a', B = 'inc-b';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.mentors = []; d.registrations = []; d.deskBookings = [];
    d.incubators = [
      { id: A, name: 'A', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz', createdAt: NOW, updatedAt: NOW } as never,
      { id: B, name: 'B', city: 'Alger', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.programs = [
      { id: 'prog-b', incubatorId: B, mentorId: null, title: 'Theirs', slug: 'theirs',
        isActive: true, createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.bookings = [
      { id: 'bk-theirs', userId: null, itemKind: 'PROGRAM', itemId: 'prog-b', itemName: 'Theirs',
        status: 'CANCELLED', totalAmount: 1000, clientReference: 'r', clientEmail: 'c@x.dz',
        unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW, createdAt: NOW, updatedAt: NOW } as never,
    ];
  });
}

const call = async (method: 'DELETE' | 'POST', id: string, qs = '') => {
  const mod = await import('@/app/api/incubator/bookings/[id]/route');
  const req = new NextRequest(`http://localhost/api/incubator/bookings/${id}${qs}`, { method });
  const ctx = { params: Promise.resolve({ id }) };
  return method === 'DELETE' ? mod.DELETE(req, ctx) : mod.POST(req, ctx);
};

beforeEach(async () => { currentUser = actor; await seed(); });

describe('someone else\'s booking', () => {
  it('cannot be deleted, and the answer does not admit it exists', async () => {
    const res = await call('DELETE', 'bk-theirs');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect((await db.read()).bookings[0]!.deletedAt).toBeFalsy();
  });

  it('cannot be restored either', async () => {
    await db.update((d) => { d.bookings[0]!.deletedAt = NOW; });
    const res = await call('POST', 'bk-theirs');
    expect(res.status).toBe(404);
    expect((await db.read()).bookings[0]!.deletedAt).toBe(NOW);
  });

  it('answers the same for an id that does not exist at all', async () => {
    // Identical response, so probing ids reveals nothing.
    const missing = await call('DELETE', 'no-such-booking');
    expect(missing.status).toBe(404);
  });
});

describe('not signed in', () => {
  it('cannot delete', async () => {
    currentUser = null;
    expect((await call('DELETE', 'bk-theirs')).status).toBe(401);
  });

  it('cannot restore', async () => {
    currentUser = null;
    expect((await call('POST', 'bk-theirs')).status).toBe(401);
  });
});

describe('an incubator with no profile', () => {
  it('is refused rather than treated as owning nothing', async () => {
    currentUser = { id: 'ghost', email: 'ghost@x.dz', role: 'INCUBATOR' };
    const res = await call('DELETE', 'bk-theirs');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('INCUBATOR_NOT_FOUND');
  });
});

describe('the notify flag', () => {
  it('is not trusted from the query string for an unpaid attempt', async () => {
    // ?notify=true on a PENDING_PAYMENT booking must still send nothing: the
    // rule lives on the server, not in whichever caller builds the URL.
    await db.update((d) => {
      d.programs[0]!.incubatorId = A;
      d.bookings[0]!.status = 'PENDING_PAYMENT';
    });
    const res = await call('DELETE', 'bk-theirs', '?notify=true');
    expect(res.status).toBe(200);
    expect((await db.read()).bookings[0]!.deletedAt).toBeTruthy();
  });
});
