/**
 * The edit and resend endpoints, from the point of view of a caller who
 * should not be able to use them.
 *
 * Editing changes what a receipt says and who it is sent to, and resending
 * generates a PDF and two emails — so both are worth probing rather than
 * trusting because the happy path works.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as EmailModule from '@/server/notifications/email';

const sent: Array<{ to: string }> = [];
vi.mock('@/server/notifications/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return { ...actual, sendResendEmail: async (o: { to: string }) => { sent.push(o); return true; } };
});

const actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
let currentUser: typeof actor | null = actor;
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => currentUser
    ? { ok: true, user: currentUser }
    : { ok: false, response: new Response('no', { status: 401 }) }),
  requireApprovedApiRole: vi.fn(async () => currentUser
    ? { ok: true, user: currentUser }
    : { ok: false, response: new Response('no', { status: 401 }) }),
}));

import { db } from '@/server/db/store';

const NOW = '2026-09-01T00:00:00.000Z';
const A = 'inc-a', B = 'inc-b';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.mentors = []; d.clients = []; d.registrationFormFields = [];
    d.incubators = [
      { id: A, name: 'A', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz', createdAt: NOW, updatedAt: NOW } as never,
      { id: B, name: 'B', city: 'Alger', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.programs = [
      { id: 'prog-b', incubatorId: B, mentorId: null, title: 'Theirs', slug: 't', isActive: true, createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.registrations = [
      { id: 'reg-theirs', entityType: 'PROGRAM', entityId: 'prog-b', incubatorId: B, mentorId: null,
        userId: null, fullName: 'Not Yours', email: 'them@x.dz', phone: '+213700000000',
        answers: [], status: 'CONFIRMED', clientId: null, bookingId: null,
        createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.bookings = [];
  });
}

// Static imports: a template-literal import trips vite's dynamic-import-vars.
const routes = {
  edit: () => import('@/app/api/incubator/registrations/edit/route'),
  resend: () => import('@/app/api/incubator/registrations/resend/route'),
};

const post = async (path: 'edit' | 'resend', body: unknown) => {
  const mod = await routes[path]();
  return mod.POST(new NextRequest(`http://localhost/api/incubator/registrations/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
};

beforeEach(async () => { currentUser = actor; sent.length = 0; await seed(); });

describe('another owner\'s registration', () => {
  it('cannot be edited, and the answer does not admit it exists', async () => {
    const res = await post('edit', { id: 'reg-theirs', fullName: 'Hijacked' });
    expect(res.status).toBe(404);
    expect((await db.read()).registrations[0]!.fullName).toBe('Not Yours');
  });

  it('cannot have its confirmation resent', async () => {
    const res = await post('resend', { id: 'reg-theirs' });
    expect(res.status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});

describe('not signed in', () => {
  it('cannot edit or resend', async () => {
    currentUser = null;
    expect((await post('edit', { id: 'reg-theirs', fullName: 'X' })).status).toBe(401);
    expect((await post('resend', { id: 'reg-theirs' })).status).toBe(401);
  });
});

describe('what the edit accepts', () => {
  beforeEach(async () => {
    await db.update((d) => { d.programs[0]!.incubatorId = A; d.registrations[0]!.incubatorId = A; });
  });

  it('refuses a malformed email', async () => {
    expect((await post('edit', { id: 'reg-theirs', email: 'not-an-email' })).status).toBe(422);
  });

  it('refuses a request that changes nothing', async () => {
    expect((await post('edit', { id: 'reg-theirs' })).status).toBe(422);
  });

  it('ignores fields it does not own — status stays put', async () => {
    // Zod strips unknown keys, so a caller cannot smuggle a status change
    // through the edit endpoint.
    const res = await post('edit', { id: 'reg-theirs', fullName: 'Fixed', status: 'CANCELLED' });
    expect(res.status).toBe(200);
    const row = (await db.read()).registrations[0]!;
    expect(row.fullName).toBe('Fixed');
    expect(row.status).toBe('CONFIRMED');
  });

  it('rejects a body that is not JSON', async () => {
    const mod = await import('@/app/api/incubator/registrations/edit/route');
    const res = await mod.POST(new NextRequest('http://localhost/api/incubator/registrations/edit', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    }));
    expect(res.status).toBe(400);
  });
});

describe('the resend rate limit', () => {
  beforeEach(async () => {
    await db.update((d) => { d.programs[0]!.incubatorId = A; d.registrations[0]!.incubatorId = A; });
  });

  it('stops after a few, so a frustrated double-click cannot bury the client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post('resend', { id: 'reg-theirs' })).status);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(3);
    expect(codes).toContain(429);
  });
});
