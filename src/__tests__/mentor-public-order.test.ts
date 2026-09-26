/**
 * The order of mentors on the public site, set by the admin.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

let actor: { id: string; email: string; role: string } | null = { id: 'admin-1', email: 'admin@x.dz', role: 'ADMIN' };
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async (roles: string[]) => actor && roles.includes(actor.role)
    ? { ok: true, user: actor }
    : { ok: false, response: new Response('forbidden', { status: 403 }) }),
}));

import { db, type MentorRecord } from '@/server/db/store';
import { listPublicMentors, listMentors } from '@/server/mentors/service';
import { compareMentorsForAdmin, saveMentorPublicOrder } from '@/server/mentors/order';
import { setMentorPublished } from '@/server/mentors/approval';

function mentor(id: string, created: string, extra: Partial<MentorRecord> = {}): MentorRecord {
  return {
    id, fullName: id, position: 'X', imageUrl: '', slug: id, bio: null, linkedinUrl: null,
    createdAt: `2026-01-${created}T00:00:00.000Z`, ...extra,
  } as MentorRecord;
}

const ADMIN = { id: 'admin-1', email: 'admin@x.dz' };

beforeEach(async () => {
  actor = { id: 'admin-1', email: 'admin@x.dz', role: 'ADMIN' };
  await db.update((d) => {
    d.mentors = [
      mentor('oldest', '01'),
      mentor('middle', '02'),
      mentor('newest', '03'),
      mentor('hidden', '04', { publiclyListed: false }),
      mentor('self-unlisted', '05', { source: 'SELF', approvalStatus: 'APPROVED' }),
      mentor('pending', '06', { source: 'SELF', approvalStatus: 'PENDING' }),
    ];
    d.auditLogs = [];
  });
});

const publicIds = async () => (await listPublicMentors()).map((m) => m.id);

describe('the public order', () => {
  it('is today\'s order — date added — until an order is saved', async () => {
    expect(await publicIds()).toEqual(['oldest', 'middle', 'newest']);
  });

  it('follows the saved order everywhere the public list is read', async () => {
    expect(await saveMentorPublicOrder(['newest', 'oldest', 'middle'], ADMIN)).toMatchObject({ ok: true });
    expect(await publicIds()).toEqual(['newest', 'oldest', 'middle']);
    const d = await db.read();
    expect(d.auditLogs.some((l) => l.action === 'MENTOR_REORDERED')).toBe(true);
  });

  it('puts a mentor added or published later at the end', async () => {
    await saveMentorPublicOrder(['newest', 'oldest', 'middle'], ADMIN);
    await db.update((d) => { d.mentors.push(mentor('brand-new', '00')); });
    await setMentorPublished({ mentorId: 'self-unlisted', publiclyListed: true, admin: ADMIN });
    expect(await publicIds()).toEqual(['newest', 'oldest', 'middle', 'brand-new', 'self-unlisted']);
  });

  it('returns a hidden mentor to their place when published again', async () => {
    await saveMentorPublicOrder(['newest', 'oldest', 'middle'], ADMIN);
    await setMentorPublished({ mentorId: 'oldest', publiclyListed: false, admin: ADMIN });
    expect(await publicIds()).toEqual(['newest', 'middle']);
    await setMentorPublished({ mentorId: 'oldest', publiclyListed: true, admin: ADMIN });
    expect(await publicIds()).toEqual(['newest', 'oldest', 'middle']);
  });

  it('can hide an admin-added mentor, who keeps their profile', async () => {
    await setMentorPublished({ mentorId: 'middle', publiclyListed: false, admin: ADMIN });
    expect(await publicIds()).not.toContain('middle');
    expect((await listMentors()).some((m) => m.id === 'middle')).toBe(true);
  });
});

describe('saving an order', () => {
  it.each([
    ['a duplicate', ['oldest', 'oldest', 'middle'], 'INVALID'],
    ['a hidden mentor', ['oldest', 'middle', 'newest', 'hidden'], 'STALE'],
    ['a pending mentor', ['oldest', 'middle', 'pending'], 'STALE'],
    ['an unknown id', ['oldest', 'middle', 'ghost'], 'STALE'],
    ['a missing mentor', ['oldest', 'middle'], 'STALE'],
  ])('refuses %s and writes nothing', async (_label, ids, reason) => {
    expect(await saveMentorPublicOrder(ids, ADMIN)).toEqual({ ok: false, reason });
    expect((await db.read()).mentors.every((m) => m.publicOrder == null)).toBe(true);
  });

  const put = (body: unknown) => new NextRequest('http://localhost/api/admin/mentors/order', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('the route saves for an admin and answers 409 on a stale list', async () => {
    const { PUT } = await import('@/app/api/admin/mentors/order/route');
    expect((await PUT(put({ ids: ['middle', 'newest', 'oldest'] }))).status).toBe(200);
    expect(await publicIds()).toEqual(['middle', 'newest', 'oldest']);
    expect((await PUT(put({ ids: ['middle'] }))).status).toBe(409);
    expect((await PUT(put({ ids: 'nope' }))).status).toBe(422);
  });

  it('only an admin may save', async () => {
    const { PUT } = await import('@/app/api/admin/mentors/order/route');
    actor = { id: 'mgr', email: 'm@x.dz', role: 'INCUBATOR' };
    expect((await PUT(put({ ids: ['middle', 'newest', 'oldest'] }))).status).toBe(403);
    expect(await publicIds()).toEqual(['oldest', 'middle', 'newest']);
  });
});

describe('the admin page order', () => {
  it('lists on-site mentors first in public order, then hidden and pending', async () => {
    await saveMentorPublicOrder(['newest', 'oldest', 'middle'], ADMIN);
    const ids = [...(await listMentors())].sort(compareMentorsForAdmin).map((m) => m.id);
    expect(ids).toEqual(['newest', 'oldest', 'middle', 'hidden', 'self-unlisted', 'pending']);
  });
});
