/**
 * Admin promo codes: delete, rename and edit.
 *
 * The bug being fixed: a deactivated code still held its name, so the same
 * code could never be created again. The interesting tests are therefore not
 * the happy path but (a) the name really is free afterwards, (b) a deleted code
 * really stops working everywhere, (c) a checkout already in flight is not
 * disturbed, and (d) nobody but an admin can do any of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Actor = { id: string; email: string; role: string };
const admin: Actor = { id: 'adm-1', email: 'admin@x.dz', role: 'ADMIN' };
let currentUser: Actor | null = admin;

vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async (roles: string[]) => {
    if (!currentUser) return { ok: false, response: new Response('unauthorised', { status: 401 }) };
    if (!roles.includes(currentUser.role)) return { ok: false, response: new Response('forbidden', { status: 403 }) };
    return { ok: true, user: currentUser };
  }),
}));

import { db } from '@/server/db/store';
import {
  createPromoCode,
  validatePromoCodeSync,
  consumePromoCodeSync,
} from '@/server/promo-codes/service';
import { lookupAnyPromoCode } from '@/server/promo-codes/lookup';

const base = { discountPercent: 20, appliesTo: 'ALL' as const, expiresAt: null, usageLimit: null };

async function seedFlag(): Promise<void> {
  // Keep the dev seeder (WELCOME50 / FREE100) out of the way.
  await db.update((d) => { d.promoCodes = []; if (!d.meta) d.meta = {}; d.meta.promoCodesSeeded = true; d.auditLogs = []; });
}

const route = async () => import('@/app/api/admin/promo-codes/route');
const idRoute = async () => import('@/app/api/admin/promo-codes/[id]/route');

const patch = async (id: string, body: unknown) => {
  const mod = await idRoute();
  return mod.PATCH(
    new NextRequest(`http://localhost/api/admin/promo-codes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
};
const del = async (id: string) => {
  const mod = await idRoute();
  return mod.DELETE(
    new NextRequest(`http://localhost/api/admin/promo-codes/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  );
};
const create = async (body: unknown) => {
  const mod = await route();
  return mod.POST(new NextRequest('http://localhost/api/admin/promo-codes', { method: 'POST', body: JSON.stringify(body) }));
};

beforeEach(async () => { currentUser = admin; await seedFlag(); });

describe('delete frees the name (the original bug)', () => {
  it('a deactivated code blocks its name, with a message that says what to do', async () => {
    const c = await createPromoCode({ ...base, code: 'RAMADAN' });
    expect((await patch(c.id, { isActive: false })).status).toBe(200);

    const res = await create({ ...base, code: 'RAMADAN' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROMO_CODE_EXISTS_INACTIVE');
  });

  it('after Delete the same name can be created again, as a different record', async () => {
    const c = await createPromoCode({ ...base, code: 'RAMADAN' });
    expect((await del(c.id)).status).toBe(200);

    const res = await create({ ...base, code: 'ramadan', discountPercent: 35 });
    expect(res.status).toBe(201);
    const again = await res.json();
    expect(again.code).toBe('RAMADAN');
    expect(again.id).not.toBe(c.id);
    expect(again.usedCount).toBe(0);
    expect((await db.read()).promoCodes).toHaveLength(1);
  });

  it('an active code still blocks its name with the plain conflict code', async () => {
    await createPromoCode({ ...base, code: 'LIVE10' });
    const res = await create({ ...base, code: 'live10' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROMO_CODE_EXISTS');
  });

  it('deleting something that is not there is a 404, and touches nothing else', async () => {
    const keep = await createPromoCode({ ...base, code: 'KEEPME' });
    const res = await del('no-such-id');
    expect(res.status).toBe(404);
    expect((await db.read()).promoCodes.map((c) => c.id)).toEqual([keep.id]);
  });
});

describe('a deleted code stops working everywhere', () => {
  it('the booking validator, the unified lookup and the public lookup all reject it', async () => {
    const c = await createPromoCode({ ...base, code: 'GONE20' });
    const before = await db.read();
    expect(validatePromoCodeSync(before.promoCodes, 'GONE20', 10_000, 'SPACE').valid).toBe(true);

    await del(c.id);
    const after = await db.read();
    expect(validatePromoCodeSync(after.promoCodes, 'GONE20', 10_000, 'SPACE').valid).toBe(false);
    expect(validatePromoCodeSync(after.promoCodes, 'GONE20', 10_000, 'PROGRAM').valid).toBe(false);
    const looked = await lookupAnyPromoCode('GONE20');
    expect(looked).toMatchObject({ kind: 'INVALID', reason: 'NOT_FOUND' });
  });

  it('a checkout quoted before the delete still settles: consuming a missing id is a no-op', async () => {
    const c = await createPromoCode({ ...base, code: 'MIDFLIGHT' });
    // Intent time: the discounted total is frozen and the id remembered.
    const quote = validatePromoCodeSync((await db.read()).promoCodes, 'MIDFLIGHT', 10_000, 'PROGRAM');
    expect(quote).toMatchObject({ valid: true, finalAmount: 8_000, promoCodeId: c.id });

    await del(c.id);

    // Settlement time: must not throw, must not resurrect or touch other codes.
    const other = await createPromoCode({ ...base, code: 'OTHER' });
    await db.update((d) => { consumePromoCodeSync(d.promoCodes, quote.promoCodeId!); });
    const codes = (await db.read()).promoCodes;
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ id: other.id, usedCount: 0 });
  });

  it('a recreated code does not inherit the old one\'s in-flight id', async () => {
    const old = await createPromoCode({ ...base, code: 'REUSED' });
    await del(old.id);
    const fresh = await createPromoCode({ ...base, code: 'REUSED' });
    await db.update((d) => { consumePromoCodeSync(d.promoCodes, old.id); });
    expect((await db.read()).promoCodes.find((c) => c.id === fresh.id)!.usedCount).toBe(0);
  });
});

describe('rename and edit', () => {
  it('rename frees the old name and takes the new one', async () => {
    const c = await createPromoCode({ ...base, code: 'OLDNAME' });
    const res = await patch(c.id, { code: 'newname' });
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe('NEWNAME');

    expect((await create({ ...base, code: 'OLDNAME' })).status).toBe(201);
    expect((await lookupAnyPromoCode('NEWNAME')).kind).toBe('REGULAR');
  });

  it('renaming onto another code is refused and changes nothing', async () => {
    const a = await createPromoCode({ ...base, code: 'AAA' });
    await createPromoCode({ ...base, code: 'BBB' });
    const res = await patch(a.id, { code: 'bbb' });
    expect(res.status).toBe(409);
    expect((await db.read()).promoCodes.find((c) => c.id === a.id)!.code).toBe('AAA');
  });

  it('renaming onto a deactivated code says so', async () => {
    const a = await createPromoCode({ ...base, code: 'AAA' });
    const b = await createPromoCode({ ...base, code: 'BBB' });
    await patch(b.id, { isActive: false });
    const res = await patch(a.id, { code: 'BBB' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROMO_CODE_EXISTS_INACTIVE');
  });

  it('"renaming" a code to itself (case aside) is not a conflict with itself', async () => {
    const a = await createPromoCode({ ...base, code: 'SAME' });
    expect((await patch(a.id, { code: 'same', discountPercent: 30 })).status).toBe(200);
  });

  it('an edited discount applies to the next redemption', async () => {
    const c = await createPromoCode({ ...base, code: 'TUNE' });
    await patch(c.id, { discountPercent: 50, appliesTo: 'SPACE', usageLimit: 5 });
    const codes = (await db.read()).promoCodes;
    expect(validatePromoCodeSync(codes, 'TUNE', 10_000, 'SPACE')).toMatchObject({ valid: true, finalAmount: 5_000 });
    // …and the scope edit is honoured: no longer valid for a program.
    expect(validatePromoCodeSync(codes, 'TUNE', 10_000, 'PROGRAM').valid).toBe(false);
  });

  it('rejects hostile or malformed input without changing the record', async () => {
    const c = await createPromoCode({ ...base, code: 'SAFE' });
    for (const bad of [
      { code: 'a b' }, { code: '<script>' }, { code: 'ab' }, { code: 'x'.repeat(33) },
      { discountPercent: 0 }, { discountPercent: 101 }, { discountPercent: 12.5 },
      { appliesTo: 'EVERYTHING' }, { usageLimit: 0 }, { expiresAt: 'tomorrow' },
    ]) {
      expect((await patch(c.id, bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await db.read()).promoCodes[0]).toMatchObject({ code: 'SAFE', discountPercent: 20 });
  });

  it('bad JSON is a 400, not a crash', async () => {
    const c = await createPromoCode({ ...base, code: 'JSONX' });
    const mod = await idRoute();
    const res = await mod.PATCH(
      new NextRequest('http://localhost/x', { method: 'PATCH', body: '{nope' }),
      { params: Promise.resolve({ id: c.id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('only an admin can do any of it', () => {
  it.each([
    ['an incubator', { id: 'u1', email: 'i@x.dz', role: 'INCUBATOR' }],
    ['an entrepreneur', { id: 'u2', email: 'e@x.dz', role: 'ENTREPRENEUR' }],
    ['an investor', { id: 'u3', email: 'v@x.dz', role: 'INVESTOR' }],
    ['nobody (signed out)', null],
  ])('%s is refused on PATCH, DELETE and POST, and nothing changes', async (_who, user) => {
    const c = await createPromoCode({ ...base, code: 'LOCKED' });
    currentUser = user;

    const statuses = [
      (await patch(c.id, { code: 'HACKED' })).status,
      (await del(c.id)).status,
      (await create({ ...base, code: 'NEWONE' })).status,
    ];
    for (const s of statuses) expect([401, 403]).toContain(s);

    const codes = (await db.read()).promoCodes;
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ id: c.id, code: 'LOCKED' });
  });
});

describe('audit trail', () => {
  it('create, edit and delete each leave an entry naming the admin and the code', async () => {
    const res = await create({ ...base, code: 'TRAILED' });
    const { id } = await res.json();
    await patch(id, { discountPercent: 40 });
    await del(id);

    const logs = (await db.read()).auditLogs ?? [];
    expect(logs.map((l) => l.action)).toEqual(['PROMO_CODE_CREATED', 'PROMO_CODE_UPDATED', 'PROMO_CODE_DELETED']);
    for (const l of logs) {
      expect(l).toMatchObject({ adminId: 'adm-1', targetType: 'promo_code', targetId: id });
      expect(l.details).toMatchObject({ code: 'TRAILED' });
    }
  });

  it('a refused request leaves no audit entry', async () => {
    const c = await createPromoCode({ ...base, code: 'QUIET' });
    currentUser = { id: 'u1', email: 'i@x.dz', role: 'INCUBATOR' };
    await del(c.id);
    expect((await db.read()).auditLogs ?? []).toHaveLength(0);
  });
});
