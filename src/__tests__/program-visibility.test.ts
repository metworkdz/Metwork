/**
 * Public and unlisted programs, and the link that leads to them.
 *
 * An unlisted program must be absent from the catalogue and fully working by
 * its link. Since that link is then the only way in, it must lead to exactly
 * one program: slugs are unique across the platform, not per owner.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

let actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: actor }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
let consultantId = 'mentor-1';
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: consultantId })),
}));

import { db } from '@/server/db/store';
import { findProgramById, listPrograms } from '@/server/bookings/program-catalog';
import { findProgramBySlugOrId } from '@/server/registrations/service';
import { allocateProgramSlug, isProgramSlugFree } from '@/server/programs/slug';
import { isProgramPubliclyListed, isProgramPubliclyReachable } from '@/server/programs/ownership';

const NOW = '2026-09-01T00:00:00.000Z';

function program(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, incubatorId: 'inc-a', incubatorName: 'Hub A', mentorId: null, title: `P ${id}`,
    description: 'Une description suffisante.', type: 'TRAINING', city: 'Alger', imageUrl: null,
    price: 0, seatsTotal: 20, deadline: NOW, startDate: NOW, endDate: NOW,
    acceptedPaymentMethods: ['ONLINE'], isActive: true, slug: id, createdAt: NOW, updatedAt: NOW,
    ...extra,
  } as never;
}

const lookups = {
  incubators: [{ id: 'inc-a', status: 'ACTIVE', archivedAt: null }] as never,
  mentors: [],
};

beforeEach(async () => {
  actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
  consultantId = 'mentor-1';
  await db.update((d) => {
    d.users = [];
    d.incubators = [
      { id: 'inc-a', name: 'Hub A', managerId: 'mgr-a', email: 'a@x.dz', status: 'ACTIVE', archivedAt: null } as never,
      { id: 'inc-b', name: 'Hub B', managerId: 'mgr-b', email: 'b@x.dz', status: 'ACTIVE', archivedAt: null } as never,
    ];
    d.mentors = [{ id: 'mentor-1', fullName: 'Amina', approvalStatus: 'APPROVED', source: 'ADMIN' } as never];
    d.programs = [
      program('public-one'),
      program('legacy-no-field'),
      program('unlisted-one', { visibility: 'UNLISTED' }),
      program('draft-unlisted', { visibility: 'UNLISTED', isActive: false }),
      program('theirs', { incubatorId: 'inc-b', incubatorName: 'Hub B' }),
    ];
    d.registrations = [];
    d.bookings = [];
  });
});

describe('the rule', () => {
  it('an unlisted program is reachable but not listed; a legacy program is public', () => {
    expect(isProgramPubliclyListed(program('x', { visibility: 'UNLISTED' }), lookups)).toBe(false);
    expect(isProgramPubliclyReachable(program('x', { visibility: 'UNLISTED' }), lookups)).toBe(true);
    expect(isProgramPubliclyListed(program('x'), lookups)).toBe(true);
    expect(isProgramPubliclyListed(program('x', { visibility: 'PUBLIC' }), lookups)).toBe(true);
  });

  it('a draft stays unreachable, unlisted or not', () => {
    expect(isProgramPubliclyReachable(program('x', { visibility: 'UNLISTED', isActive: false }), lookups)).toBe(false);
  });
});

describe('the catalogue and the link', () => {
  it('the /programs catalogue leaves unlisted programs out', async () => {
    const ids = (await listPrograms()).map((p) => p.id).sort();
    expect(ids).toEqual(['legacy-no-field', 'public-one', 'theirs']);
  });

  it('the link still opens an unlisted program, by slug or by id', async () => {
    expect((await findProgramBySlugOrId('unlisted-one'))?.id).toBe('unlisted-one');
    expect((await findProgramById('unlisted-one'))?.visibility).toBe('UNLISTED');
    expect(await findProgramBySlugOrId('draft-unlisted')).toBeNull();
  });

  it('owner lists report the visibility, public by default', async () => {
    const { GET } = await import('@/app/api/incubator/programs/route');
    const body = await (await GET()).json() as { items: Array<{ id: string; visibility: string }> };
    const byId = Object.fromEntries(body.items.map((p) => [p.id, p.visibility]));
    expect(byId['legacy-no-field']).toBe('PUBLIC');
    expect(byId['unlisted-one']).toBe('UNLISTED');
  });
});

const valid = {
  title: 'Formation juridique',
  description: 'Une formation pour les fondateurs.',
  type: 'TRAINING',
  city: 'Alger',
  price: 0,
  seatsTotal: 30,
  deadline: '2026-10-01T11:00:00.000Z',
  startDate: '2026-10-05T11:00:00.000Z',
  endDate: '2026-10-06T11:00:00.000Z',
  acceptedPaymentMethods: ['ONLINE'],
};
const post = (body: unknown) => new NextRequest('http://localhost/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const patch = (body: unknown) => new NextRequest('http://localhost/x', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('creating', () => {
  it('defaults to public, accepts unlisted, refuses anything else — incubator', async () => {
    const { POST } = await import('@/app/api/incubator/programs/route');
    expect((await (await POST(post(valid))).json()).visibility).toBe('PUBLIC');
    expect((await (await POST(post({ ...valid, visibility: 'UNLISTED' }))).json()).visibility).toBe('UNLISTED');
    expect((await POST(post({ ...valid, visibility: 'SECRET' }))).status).toBe(422);
  });

  it('defaults to public, accepts unlisted — consultant', async () => {
    const { POST } = await import('@/app/api/consultant/programs/route');
    expect((await (await POST(post(valid))).json()).visibility).toBe('PUBLIC');
    expect((await (await POST(post({ ...valid, visibility: 'UNLISTED' }))).json()).visibility).toBe('UNLISTED');
  });

  it('two hosts with the same title get two different links', async () => {
    const incubator = await import('@/app/api/incubator/programs/route');
    const consultant = await import('@/app/api/consultant/programs/route');
    const a = await (await incubator.POST(post(valid))).json();
    actor = { id: 'mgr-b', email: 'b@x.dz', role: 'INCUBATOR' };
    const b = await (await incubator.POST(post(valid))).json();
    const c = await (await consultant.POST(post(valid))).json();
    expect(a.slug).toBe('formation-juridique');
    expect(new Set([a.slug, b.slug, c.slug]).size).toBe(3);
    // Each link opens its own program.
    for (const p of [a, b, c]) expect((await findProgramBySlugOrId(p.slug))?.id).toBe(p.id);
  });

  it('a requested link that is taken is suffixed, never shared', async () => {
    const { POST } = await import('@/app/api/incubator/programs/route');
    const res = await (await POST(post({ ...valid, slug: 'theirs' }))).json();
    expect(res.slug).toBe('theirs-2');
  });
});

describe('editing', () => {
  it('the owner switches between public and unlisted', async () => {
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/route');
    expect((await (await PATCH(patch({ visibility: 'UNLISTED' }), ctx('public-one'))).json()).program.visibility).toBe('UNLISTED');
    expect((await listPrograms()).some((p) => p.id === 'public-one')).toBe(false);
    await PATCH(patch({ visibility: 'PUBLIC' }), ctx('public-one'));
    expect((await listPrograms()).some((p) => p.id === 'public-one')).toBe(true);
  });

  it('nobody else can change it', async () => {
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/route');
    expect((await PATCH(patch({ visibility: 'UNLISTED' }), ctx('theirs'))).status).toBe(403);
    const consultant = await import('@/app/api/consultant/programs/[id]/route');
    expect((await consultant.PATCH(patch({ visibility: 'UNLISTED' }), ctx('public-one'))).status).toBe(403);
    const d = await db.read();
    expect(d.programs.filter((p) => p.visibility === 'UNLISTED').map((p) => p.id).sort())
      .toEqual(['draft-unlisted', 'unlisted-one']);
  });

  it('refuses a link another program uses — its slug or its id — and changes nothing', async () => {
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/route');
    for (const slug of ['theirs', 'unlisted-one']) {
      const res = await PATCH(patch({ slug, title: 'Changed title' }), ctx('public-one'));
      expect(res.status).toBe(409);
    }
    await db.update((d) => { d.programs.push(program('0b1c2d3e-4f50-4617-8899-aabbccddeeff', { slug: null })); });
    expect((await PATCH(patch({ slug: '0b1c2d3e-4f50-4617-8899-aabbccddeeff' }), ctx('public-one'))).status).toBe(409);
    const p = (await db.read()).programs.find((x) => x.id === 'public-one')!;
    // The refused edit wrote nothing — not even the title sent with it.
    expect(p).toMatchObject({ slug: 'public-one', title: 'P public-one' });
  });

  it('keeping its own link, or taking a free one, is fine', async () => {
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/route');
    expect((await PATCH(patch({ slug: 'public-one', title: 'Same link' }), ctx('public-one'))).status).toBe(200);
    expect((await PATCH(patch({ slug: 'a-fresh-link' }), ctx('public-one'))).status).toBe(200);
    expect((await findProgramBySlugOrId('a-fresh-link'))?.id).toBe('public-one');
  });
});

describe('slug helpers', () => {
  const programs = [{ id: 'id-1', slug: 'formation' }, { id: 'id-2', slug: null }];
  it('allocates around slugs and ids alike', () => {
    expect(allocateProgramSlug(programs, null, 'Formation')).toBe('formation-2');
    expect(allocateProgramSlug(programs, 'id-2', 'x')).toBe('id-2-2');
    expect(allocateProgramSlug(programs, null, '!!!')).toBe('programme');
  });
  it('a program keeps its own slug', () => {
    expect(isProgramSlugFree(programs, 'formation', 'id-1')).toBe(true);
    expect(isProgramSlugFree(programs, 'formation', 'id-2')).toBe(false);
  });
});
