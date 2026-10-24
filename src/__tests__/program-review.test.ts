/**
 * A consultant's program is reviewed by an admin before it goes public.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

let role = 'ADMIN';
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async (roles: string[]) => roles.includes(role)
    ? { ok: true, user: { id: 'admin-1', email: 'a@x.dz', role } }
    : { ok: false, response: new Response('forbidden', { status: 403 }) }),
}));

import { db } from '@/server/db/store';
import { isProgramPubliclyListed, isProgramPubliclyReachable } from '@/server/programs/ownership';
import { PATCH } from '@/app/api/admin/programs/[id]/review/route';
import { getNotificationCounts } from '@/server/notifications/counts';

const mentors = [
  { id: 'm-pub', approvalStatus: 'APPROVED', source: 'SELF', publiclyListed: true },
  { id: 'm-hidden', approvalStatus: 'APPROVED', source: 'SELF', publiclyListed: false },
] as never[];
const lookups = { incubators: [{ id: 'inc', status: 'ACTIVE', archivedAt: null }] as never[], mentors };
const prog = (extra: Record<string, unknown>) => ({ isActive: true, incubatorId: null, mentorId: 'm-hidden', visibility: 'PUBLIC', ...extra }) as never;

describe('the public rules', () => {
  it('pending and rejected consultant programs are neither listed nor reachable', () => {
    for (const reviewStatus of ['PENDING', 'REJECTED']) {
      expect(isProgramPubliclyReachable(prog({ reviewStatus }), lookups)).toBe(false);
      expect(isProgramPubliclyListed(prog({ reviewStatus }), lookups)).toBe(false);
    }
  });

  it('an approved program is listed even when its consultant is not on the mentors page', () => {
    expect(isProgramPubliclyListed(prog({ reviewStatus: 'APPROVED' }), lookups)).toBe(true);
    expect(isProgramPubliclyListed(prog({ reviewStatus: 'APPROVED', visibility: 'UNLISTED' }), lookups)).toBe(false);
  });

  it('older programs (no review status) keep the old rule', () => {
    expect(isProgramPubliclyListed(prog({}), lookups)).toBe(false);
    expect(isProgramPubliclyListed(prog({ mentorId: 'm-pub' }), lookups)).toBe(true);
    expect(isProgramPubliclyReachable(prog({}), lookups)).toBe(true);
  });

  it('incubator programs are never reviewed', () => {
    expect(isProgramPubliclyListed(prog({ mentorId: null, incubatorId: 'inc', reviewStatus: 'PENDING' }), lookups)).toBe(true);
  });
});

const NOW = '2026-10-01T00:00:00.000Z';
beforeEach(async () => {
  role = 'ADMIN';
  await db.update((d) => {
    d.programs = [
      { id: 'p-cons', mentorId: 'm-hidden', incubatorId: null, title: 'Flutter', isActive: true, reviewStatus: 'PENDING', createdAt: NOW, updatedAt: NOW } as never,
      { id: 'p-inc', mentorId: null, incubatorId: 'inc', title: 'Inc', isActive: true, createdAt: NOW, updatedAt: NOW } as never,
    ];
  });
});

const review = (id: string, body: unknown) => PATCH(new NextRequest('http://localhost/x', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id }) });

describe('the admin review', () => {
  it('approves', async () => {
    expect((await review('p-cons', { decision: 'APPROVE' })).status).toBe(200);
    expect((await db.read()).programs.find((p) => p.id === 'p-cons')).toMatchObject({ reviewStatus: 'APPROVED', reviewedBy: 'admin-1' });
  });

  it('a rejection needs a reason, and keeps it', async () => {
    expect((await review('p-cons', { decision: 'REJECT' })).status).toBe(422);
    expect((await db.read()).programs.find((p) => p.id === 'p-cons')!.reviewStatus).toBe('PENDING');
    expect((await review('p-cons', { decision: 'REJECT', reason: 'Ajoutez le programme détaillé.' })).status).toBe(200);
    expect((await db.read()).programs.find((p) => p.id === 'p-cons')).toMatchObject({
      reviewStatus: 'REJECTED', reviewRejectionReason: 'Ajoutez le programme détaillé.',
    });
  });

  it('refuses an incubator program, an unknown id, and a non-admin', async () => {
    expect((await review('p-inc', { decision: 'APPROVE' })).status).toBe(409);
    expect((await review('nope', { decision: 'APPROVE' })).status).toBe(404);
    role = 'INCUBATOR';
    expect((await review('p-cons', { decision: 'APPROVE' })).status).toBe(403);
  });

  it('the admin sidebar counts what is pending', async () => {
    await db.update((d) => {
      d.users = [{ id: 'admin-1', email: 'a@x.dz', role: 'ADMIN', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never];
    });
    expect((await getNotificationCounts('admin-1')).programApprovals).toBe(1);
  });
});

describe('the public list order', () => {
  it('shows the newest program first', async () => {
    const { listPrograms } = await import('@/server/bookings/program-catalog');
    await db.update((d) => {
      d.incubators = [{ id: 'inc', status: 'ACTIVE', archivedAt: null } as never];
      d.mentors = [];
      d.programs = ['2026-01-01', '2026-03-01', '2026-02-01'].map((day, i) => ({
        id: `p${i}`, incubatorId: 'inc', mentorId: null, title: day, isActive: true, seatsTotal: 10,
        createdAt: `${day}T00:00:00.000Z`, updatedAt: NOW,
      }) as never);
    });
    expect((await listPrograms()).map((p) => p.title)).toEqual(['2026-03-01', '2026-02-01', '2026-01-01']);
  });
});
