/**
 * Incubator-owned promo codes.
 *
 * A code an incubator creates must work on exactly the programs and spaces they
 * ticked, and nowhere else — not on another incubator's listing, not on a
 * membership, not on a consultation. These tests are written from the point of
 * view of someone trying to get a discount they were not given, because that is
 * the failure that costs money. The happy path is the short part.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Actor = { id: string; email: string; role: string; approvalStatus?: string };
const incA: Actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
const incB: Actor = { id: 'mgr-b', email: 'b@x.dz', role: 'INCUBATOR' };
const admin: Actor = { id: 'adm-1', email: 'admin@x.dz', role: 'ADMIN' };
let currentUser: Actor | null = incA;

vi.mock('@/server/auth/api-guards', () => {
  const base = async (roles: string[]) => {
    if (!currentUser) return { ok: false as const, response: new Response('unauthorised', { status: 401 }) };
    if (!roles.includes(currentUser.role)) return { ok: false as const, response: new Response('forbidden', { status: 403 }) };
    return { ok: true as const, user: currentUser };
  };
  return {
    requireApiRole: vi.fn(base),
    requireApprovedApiRole: vi.fn(async (roles: string[]) => {
      const g = await base(roles);
      if (!g.ok) return g;
      if (g.user.approvalStatus === 'PENDING') {
        return { ok: false as const, response: new Response('pending', { status: 403 }) };
      }
      return g;
    }),
  };
});
vi.mock('@/server/auth/session', () => ({ readSession: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: vi.fn(async () => true) }));

import { db } from '@/server/db/store';
import {
  createPromoCode,
  promoAppliesToType,
  promoScopeAllows,
  resolvePromoItem,
  validatePromoCode,
  validatePromoCodeSync,
  type PromoItemRef,
} from '@/server/promo-codes/service';
import { lookupAnyPromoCode, promoAppliesTo } from '@/server/promo-codes/lookup';
import { createIncubatorPromoCode } from '@/server/promo-codes/incubator-service';
import { createCardBookingIntent } from '@/server/bookings/card-payment';

const NOW = '2026-01-01T00:00:00.000Z';
const A = 'inc-a';
const B = 'inc-b';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.wallets = []; d.transactions = []; d.bookings = []; d.registrations = [];
    d.registrationFormFields = []; d.promoCodes = []; d.auditLogs = []; d.events = [];
    if (!d.meta) d.meta = {};
    d.meta.promoCodesSeeded = true;
    d.incubators = [
      { id: A, name: 'A', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz', createdAt: NOW, updatedAt: NOW } as never,
      { id: B, name: 'B', city: 'Alger', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    const prog = (id: string, incubatorId: string | null, extra: Record<string, unknown> = {}) => ({
      id, incubatorId, incubatorName: incubatorId ?? '', mentorId: incubatorId ? null : 'mentor-1', title: id,
      description: 'x', type: 'TRAINING', city: 'Alger', imageUrl: null, imageUrls: [],
      price: 10_000, onlinePrice: null, cashPrice: null, seatsTotal: 20, seatsTaken: 0,
      deadline: '2030-01-01T00:00:00.000Z', startDate: '2030-02-01T11:00:00.000Z',
      endDate: '2030-03-01T11:00:00.000Z', acceptedPaymentMethods: ['ONLINE'],
      isActive: true, slug: id, createdAt: NOW, updatedAt: NOW, ...extra,
    }) as never;
    d.programs = [
      prog('pa1', A), prog('pa2', A), prog('pb1', B),
      prog('p-consultant', null),
    ];
    const space = (id: string, incubatorId: string) => ({
      id, incubatorId, incubatorName: incubatorId, name: id, description: 'x', category: 'MEETING_ROOM',
      city: 'Alger', imageUrl: null, pricePerHour: 2_000, pricePerDay: 10_000, isActive: true,
      createdAt: NOW, updatedAt: NOW,
    }) as never;
    d.spaces = [space('sa1', A), space('sa2', A), space('sb1', B)];
    d.events = [{ id: 'ea1', incubatorId: A, incubatorName: 'A', title: 'ev', price: 5_000 } as never];
  });
  currentUser = incA;
}

beforeEach(seed);

const create = (inc: string, over: Record<string, unknown> = {}) =>
  createIncubatorPromoCode(inc, {
    code: 'RAMADAN20', discountPercent: 20, expiresAt: null, usageLimit: null,
    programIds: ['pa1'], spaceIds: ['sa1'], ...over,
  } as never);

const itemOf = async (kind: 'SPACE' | 'PROGRAM' | 'EVENT', id: string): Promise<PromoItemRef> =>
  resolvePromoItem(await db.read(), kind, id);

/* ═════════════════════ 1. The gate itself ═════════════════════ */

describe('promoScopeAllows', () => {
  const owned = { ownerIncubatorId: A, scope: { programIds: ['pa1'], spaceIds: ['sa1'] } };

  it('lets a scoped code through on exactly the listings it names, for the owner', () => {
    expect(promoScopeAllows(owned, { kind: 'PROGRAM', id: 'pa1', ownerIncubatorId: A })).toBe(true);
    expect(promoScopeAllows(owned, { kind: 'SPACE', id: 'sa1', ownerIncubatorId: A })).toBe(true);
  });

  it('refuses a listing of the same incubator that was not ticked', () => {
    expect(promoScopeAllows(owned, { kind: 'PROGRAM', id: 'pa2', ownerIncubatorId: A })).toBe(false);
    expect(promoScopeAllows(owned, { kind: 'SPACE', id: 'sa2', ownerIncubatorId: A })).toBe(false);
  });

  it('refuses another incubator\'s listing even if its id somehow sits in the list', () => {
    const tampered = { ownerIncubatorId: A, scope: { programIds: ['pb1'], spaceIds: [] } };
    expect(promoScopeAllows(tampered, { kind: 'PROGRAM', id: 'pb1', ownerIncubatorId: B })).toBe(false);
  });

  it('does not let a program id satisfy the space list, or the reverse', () => {
    expect(promoScopeAllows(owned, { kind: 'SPACE', id: 'pa1', ownerIncubatorId: A })).toBe(false);
    expect(promoScopeAllows(owned, { kind: 'PROGRAM', id: 'sa1', ownerIncubatorId: A })).toBe(false);
  });

  it('refuses when no item is presented at all', () => {
    expect(promoScopeAllows(owned, undefined)).toBe(false);
  });

  it('refuses events, which are not scopable', () => {
    expect(promoScopeAllows(owned, { kind: 'EVENT', id: 'ea1', ownerIncubatorId: A })).toBe(false);
  });

  it('kills a half-formed record instead of leaving it accidentally global', () => {
    const item: PromoItemRef = { kind: 'PROGRAM', id: 'pa1', ownerIncubatorId: A };
    expect(promoScopeAllows({ ownerIncubatorId: A }, item)).toBe(false);
    expect(promoScopeAllows({ scope: { programIds: ['pa1'], spaceIds: [] } }, item)).toBe(false);
    expect(promoScopeAllows({ ownerIncubatorId: null, scope: { programIds: ['pa1'], spaceIds: [] } }, item)).toBe(false);
  });

  it('a record with a scope but NO owner must not match an ownerless listing (null === null)', () => {
    // A consultant-owned program resolves to ownerIncubatorId null. Without the explicit
    // half-formed check, "no owner" would compare equal to "no owner" and the code would work.
    const consultantProgram: PromoItemRef = { kind: 'PROGRAM', id: 'p-consultant', ownerIncubatorId: null };
    expect(promoScopeAllows({ ownerIncubatorId: null, scope: { programIds: ['p-consultant'], spaceIds: [] } }, consultantProgram)).toBe(false);
    expect(promoScopeAllows({ scope: { programIds: ['p-consultant'], spaceIds: [] } }, consultantProgram)).toBe(false);
  });

  it('leaves platform codes completely alone', () => {
    expect(promoScopeAllows({}, undefined)).toBe(true);
    expect(promoScopeAllows({ ownerIncubatorId: null, scope: null }, { kind: 'PROGRAM', id: 'x', ownerIncubatorId: null })).toBe(true);
  });
});

/* ═════════════ 2. Every redemption path honours it ═════════════ */

describe('the sync validator used by every booking flow', () => {
  it('discounts the ticked program and nothing else', async () => {
    await create(A, { programIds: ['pa1'], spaceIds: [] });
    const codes = (await db.read()).promoCodes;
    const ok = validatePromoCodeSync(codes, 'ramadan20', 10_000, 'PROGRAM', await itemOf('PROGRAM', 'pa1'));
    expect(ok).toMatchObject({ valid: true, discountAmount: 2_000, finalAmount: 8_000 });

    for (const [kind, id] of [['PROGRAM', 'pa2'], ['PROGRAM', 'pb1'], ['PROGRAM', 'p-consultant'], ['SPACE', 'sa1'], ['EVENT', 'ea1']] as const) {
      const r = validatePromoCodeSync(codes, 'RAMADAN20', 10_000, kind, await itemOf(kind, id));
      expect(r.valid, `${kind} ${id}`).toBe(false);
      expect(r.finalAmount).toBe(10_000);
    }
  });

  it('refuses when a caller forgets to say what is being bought (fail closed)', async () => {
    await create(A);
    const codes = (await db.read()).promoCodes;
    expect(validatePromoCodeSync(codes, 'RAMADAN20', 10_000, 'PROGRAM').valid).toBe(false);
    expect(validatePromoCodeSync(codes, 'RAMADAN20', 10_000).valid).toBe(false);
  });

  it('a platform code still works with or without an item', async () => {
    await createPromoCode({ code: 'PLATFORM10', discountPercent: 10, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    const codes = (await db.read()).promoCodes;
    expect(validatePromoCodeSync(codes, 'PLATFORM10', 10_000, 'PROGRAM').valid).toBe(true);
    expect(validatePromoCodeSync(codes, 'PLATFORM10', 10_000, 'PROGRAM', await itemOf('PROGRAM', 'pb1')).valid).toBe(true);
  });
});

describe('memberships and consultations can never use an incubator code', () => {
  beforeEach(async () => { await create(A); });

  it('the async validator (no item) answers NOT_APPLICABLE', async () => {
    expect(await validatePromoCode('RAMADAN20')).toMatchObject({ valid: false, reason: 'NOT_APPLICABLE' });
  });

  it('…and accepts it only for a listing it names', async () => {
    expect((await validatePromoCode('RAMADAN20', { kind: 'PROGRAM', id: 'pa1' })).valid).toBe(true);
    expect(await validatePromoCode('RAMADAN20', { kind: 'PROGRAM', id: 'pb1' })).toMatchObject({ valid: false, reason: 'NOT_APPLICABLE' });
    expect(await validatePromoCode('RAMADAN20', { kind: 'PROGRAM', id: 'does-not-exist' })).toMatchObject({ valid: false });
  });

  it('promoAppliesToType refuses it for consultations, memberships and spaces', async () => {
    const rec = (await db.read()).promoCodes[0]!;
    expect(promoAppliesToType(rec, 'CONSULTATION')).toBe(false);
    expect(promoAppliesToType(rec, 'MEMBERSHIP')).toBe(false);
    expect(promoAppliesToType(rec, 'SPACE')).toBe(false);
  });

  it('the unified lookup behaves the same, with the same reason code', async () => {
    expect(await lookupAnyPromoCode('RAMADAN20')).toMatchObject({ kind: 'INVALID', reason: 'NOT_APPLICABLE' });
    expect((await lookupAnyPromoCode('RAMADAN20', { kind: 'PROGRAM', id: 'pa1' })).kind).toBe('REGULAR');
    const hit = await lookupAnyPromoCode('RAMADAN20', { kind: 'PROGRAM', id: 'pa1' });
    if (hit.kind === 'REGULAR') {
      expect(promoAppliesTo(hit, 'MEMBERSHIP')).toBe(false);
      expect(promoAppliesTo(hit, 'CONSULTATION')).toBe(false);
      expect(promoAppliesTo(hit, 'PROGRAM')).toBe(true);
    }
  });

  it('even if appliesTo is edited to say MEMBERSHIP, the scope still decides', async () => {
    await db.update((d) => { d.promoCodes[0]!.appliesTo = 'MEMBERSHIP'; });
    expect(await validatePromoCode('RAMADAN20')).toMatchObject({ valid: false });
    const rec = (await db.read()).promoCodes[0]!;
    expect(promoAppliesToType(rec, 'MEMBERSHIP')).toBe(false);
  });
});

describe('a real card checkout intent (the money path)', () => {
  const input = (programId: string, promoCode: string | null) => ({
    target: { itemKind: 'PROGRAM' as const, programId },
    paymentMode: 'ONLINE_FULL' as const,
    customer: { fullName: 'Karim', email: 'karim@example.dz', phone: '+213700112233' },
    clientReference: `ref-${programId}-${promoCode ?? 'none'}-${Math.random().toString(36).slice(2)}`,
    promoCode,
  });

  it('freezes the discounted total on the ticked program', async () => {
    const code = await create(A, { programIds: ['pa1'], spaceIds: [] });
    const r = await createCardBookingIntent(input('pa1', 'ramadan20'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.promoCodeId).toBe(code.id);
    expect(r.booking.totalAmount).toBe(8_000);
  });

  it('charges the full price on a program the code was not ticked for — same incubator', async () => {
    await create(A, { programIds: ['pa1'], spaceIds: [] });
    const r = await createCardBookingIntent(input('pa2', 'RAMADAN20'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.promoCodeId ?? null).toBeNull();
    expect(r.booking.totalAmount).toBe(10_000);
  });

  it('charges the full price on ANOTHER incubator\'s program', async () => {
    await create(A, { programIds: ['pa1'], spaceIds: [] });
    const r = await createCardBookingIntent(input('pb1', 'RAMADAN20'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.promoCodeId ?? null).toBeNull();
    expect(r.booking.totalAmount).toBe(10_000);
  });

  it('B cannot gain from A\'s code by creating a same-named one: names are unique', async () => {
    await create(A, { programIds: ['pa1'], spaceIds: [] });
    await expect(create(B, { programIds: ['pb1'], spaceIds: [] })).rejects.toThrow('PROMO_CODE_EXISTS');
  });
});

/* ═════════════ 3. The public validate endpoint ═════════════ */

describe('POST /api/promo-codes/validate', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/promo-codes/validate/route');
    return POST(new NextRequest('http://localhost/api/promo-codes/validate', { method: 'POST', body: JSON.stringify(body) }));
  };

  beforeEach(async () => { await create(A, { programIds: ['pa1'], spaceIds: ['sa1'] }); });

  it('quotes the discount to a guest on the ticked program', async () => {
    const res = await (await post({ code: 'ramadan20', originalAmount: 10_000, itemKind: 'PROGRAM', itemId: 'pa1' })).json();
    expect(res).toMatchObject({ valid: true, finalAmount: 8_000, discountAmount: 2_000 });
  });

  it('quotes it on the ticked space too', async () => {
    const res = await (await post({ code: 'RAMADAN20', originalAmount: 10_000, itemKind: 'SPACE', itemId: 'sa1' })).json();
    expect(res.valid).toBe(true);
  });

  it('says "not valid for this item" — and nothing about where it IS valid — elsewhere', async () => {
    for (const [itemKind, itemId] of [['PROGRAM', 'pa2'], ['PROGRAM', 'pb1'], ['SPACE', 'sb1'], ['EVENT', 'ea1'], ['PROGRAM', 'nope']]) {
      const res = await (await post({ code: 'RAMADAN20', originalAmount: 10_000, itemKind, itemId })).json();
      expect(res).toEqual({ valid: false, error: 'This promo code is not valid for this item' });
    }
  });

  it('refuses it when no item is sent (the membership / consultation shape)', async () => {
    const res = await (await post({ code: 'RAMADAN20', originalAmount: 10_000 })).json();
    expect(res.valid).toBe(false);
  });

  it('rejects half an item', async () => {
    expect((await post({ code: 'RAMADAN20', originalAmount: 10_000, itemKind: 'PROGRAM' })).status).toBe(422);
    expect((await post({ code: 'RAMADAN20', originalAmount: 10_000, itemId: 'pa1' })).status).toBe(422);
    expect((await post({ code: 'RAMADAN20', originalAmount: 10_000, itemKind: 'MEMBERSHIP', itemId: 'x' })).status).toBe(422);
  });

  it('a platform code is unaffected by the item', async () => {
    await createPromoCode({ code: 'PLAT15', discountPercent: 15, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    expect((await (await post({ code: 'PLAT15', originalAmount: 10_000 })).json()).valid).toBe(true);
    expect((await (await post({ code: 'PLAT15', originalAmount: 10_000, itemKind: 'PROGRAM', itemId: 'pb1' })).json()).valid).toBe(true);
  });
});

/* ═════════════ 4. The incubator's own routes ═════════════ */

const listRoute = async () => import('@/app/api/incubator/promo-codes/route');
const idRoute = async () => import('@/app/api/incubator/promo-codes/[id]/route');
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/incubator/promo-codes', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const postCode = async (body: unknown) => (await listRoute()).POST(req('POST', body));
const patchCode = async (id: string, body: unknown) =>
  (await idRoute()).PATCH(req('PATCH', body), { params: Promise.resolve({ id }) });
const delCode = async (id: string) => (await idRoute()).DELETE(req('DELETE'), { params: Promise.resolve({ id }) });
const valid = { code: 'SPRING15', discountPercent: 15, programIds: ['pa1'], spaceIds: [] };

describe('creating a code', () => {
  it('stores it owned by the caller\'s incubator with exactly the chosen scope', async () => {
    const res = await postCode({ ...valid, spaceIds: ['sa1'], usageLimit: 30 });
    expect(res.status).toBe(201);
    const rec = await res.json();
    expect(rec).toMatchObject({
      code: 'SPRING15', ownerIncubatorId: A, discountPercent: 15, usageLimit: 30, usedCount: 0, isActive: true,
      scope: { programIds: ['pa1'], spaceIds: ['sa1'] },
    });
  });

  it('refuses another incubator\'s program or space, saving nothing', async () => {
    for (const bad of [{ programIds: ['pb1'] }, { programIds: ['pa1', 'pb1'] }, { programIds: [], spaceIds: ['sb1'] }]) {
      const res = await postCode({ ...valid, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect((await res.json()).error.code).toBe('PROMO_SCOPE_INVALID');
    }
    expect((await db.read()).promoCodes).toHaveLength(0);
  });

  it('refuses a consultant-owned program and an id that does not exist, with the same answer', async () => {
    const a = await postCode({ ...valid, programIds: ['p-consultant'] });
    const b = await postCode({ ...valid, programIds: ['no-such-program'] });
    expect([a.status, b.status]).toEqual([422, 422]);
    expect(await a.json()).toEqual(await b.json());
  });

  it('will not create a code that works nowhere', async () => {
    const res = await postCode({ ...valid, programIds: [], spaceIds: [] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('PROMO_SCOPE_EMPTY');
  });

  it('ignores nothing silently: owner, appliesTo and scope smuggled in the body are rejected', async () => {
    for (const extra of [
      { ownerIncubatorId: B }, { appliesTo: 'ALL' }, { scope: { programIds: ['pb1'], spaceIds: [] } },
      { isActive: false }, { usedCount: -5 }, { id: 'chosen-id' },
    ]) {
      expect((await postCode({ ...valid, ...extra })).status, JSON.stringify(extra)).toBe(422);
    }
    expect((await db.read()).promoCodes).toHaveLength(0);
  });

  it('validates the discount, the name and the numbers', async () => {
    for (const bad of [
      { discountPercent: 0 }, { discountPercent: 101 }, { discountPercent: 12.5 },
      { code: 'a b' }, { code: 'ab' }, { code: '<img>' }, { usageLimit: 0 }, { expiresAt: 'soon' },
      { programIds: 'pa1' }, { programIds: Array.from({ length: 201 }, (_, i) => `p${i}`) },
    ]) {
      expect((await postCode({ ...valid, ...bad })).status, JSON.stringify(bad).slice(0, 60)).toBe(422);
    }
  });

  it('an allowed discount of 100% is accepted (the incubator\'s own revenue)', async () => {
    expect((await postCode({ ...valid, discountPercent: 100 })).status).toBe(201);
  });

  it('tolerates duplicate ids in the list', async () => {
    const rec = await (await postCode({ ...valid, programIds: ['pa1', 'pa1', 'pa1'] })).json();
    expect(rec.scope.programIds).toEqual(['pa1']);
  });

  it('is case-insensitive about names, like the admin side', async () => {
    await postCode(valid);
    const dup = await postCode({ ...valid, code: 'spring15' });
    expect(dup.status).toBe(409);
  });
});

describe('names are platform-wide, but nothing about other people\'s codes leaks', () => {
  it('a name held by a platform or other-incubator code is a plain conflict', async () => {
    await createPromoCode({ code: 'TAKEN1', discountPercent: 5, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    const res = await postCode({ ...valid, code: 'TAKEN1' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROMO_CODE_EXISTS');
  });

  it('a DEACTIVATED code of someone else does not announce that it is deactivated', async () => {
    const theirs = await create(B, { code: 'THEIRS', programIds: ['pb1'], spaceIds: [] });
    await db.update((d) => { d.promoCodes.find((c) => c.id === theirs.id)!.isActive = false; });
    const res = await postCode({ ...valid, code: 'THEIRS' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROMO_CODE_EXISTS');
  });

  it('…but one of the caller\'s OWN deactivated codes does, so they know what to do', async () => {
    const mine = await create(A, { code: 'MINE1' });
    await db.update((d) => { d.promoCodes.find((c) => c.id === mine.id)!.isActive = false; });
    const res = await postCode({ ...valid, code: 'MINE1' });
    expect((await res.json()).error.code).toBe('PROMO_CODE_EXISTS_INACTIVE');
  });

  it('delete frees the name for reuse (the whole point)', async () => {
    const rec = await (await postCode(valid)).json();
    expect((await delCode(rec.id)).status).toBe(200);
    expect((await postCode({ ...valid, discountPercent: 30 })).status).toBe(201);
  });
});

describe('one incubator can never see or touch another\'s codes', () => {
  it('B\'s list is empty, and A\'s list does not include B\'s or the platform\'s', async () => {
    await createPromoCode({ code: 'PLATFORM', discountPercent: 5, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    await create(A, { code: 'ACODE' });
    await create(B, { code: 'BCODE', programIds: ['pb1'], spaceIds: [] });

    currentUser = incA;
    const a = (await (await (await listRoute()).GET()).json()).items.map((c: { code: string }) => c.code);
    currentUser = incB;
    const b = (await (await (await listRoute()).GET()).json()).items.map((c: { code: string }) => c.code);
    expect(a).toEqual(['ACODE']);
    expect(b).toEqual(['BCODE']);
  });

  it('PATCH and DELETE on someone else\'s code answer exactly like a missing id, and change nothing', async () => {
    const aRec = await create(A, { code: 'ACODE' });
    currentUser = incB;

    const missing = await patchCode('no-such-id', { discountPercent: 99 });
    const foreign = await patchCode(aRec.id, { discountPercent: 99 });
    expect([missing.status, foreign.status]).toEqual([404, 404]);
    expect(await foreign.json()).toEqual(await missing.json());

    const d1 = await delCode(aRec.id);
    expect(d1.status).toBe(404);

    const after = (await db.read()).promoCodes.find((c) => c.id === aRec.id)!;
    expect(after).toMatchObject({ code: 'ACODE', discountPercent: 20, ownerIncubatorId: A });
  });

  it('the platform\'s codes are just as out of reach', async () => {
    const plat = await createPromoCode({ code: 'PLATFORM', discountPercent: 5, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    expect((await patchCode(plat.id, { discountPercent: 100 })).status).toBe(404);
    expect((await delCode(plat.id)).status).toBe(404);
    expect((await db.read()).promoCodes[0]).toMatchObject({ code: 'PLATFORM', discountPercent: 5 });
  });

  it('B cannot repoint A\'s code at B\'s own listings either', async () => {
    const aRec = await create(A, { code: 'ACODE' });
    currentUser = incB;
    expect((await patchCode(aRec.id, { attach: { programIds: ['pb1'] } })).status).toBe(404);
    expect((await db.read()).promoCodes[0]!.scope).toEqual({ programIds: ['pa1'], spaceIds: ['sa1'] });
  });
});

describe('editing scope', () => {
  it('attach adds, detach removes, both without losing what is already there', async () => {
    const rec = await create(A, { programIds: ['pa1'], spaceIds: [] });
    let r = await (await patchCode(rec.id, { attach: { programIds: ['pa2'], spaceIds: ['sa1'] } })).json();
    expect(r.scope).toEqual({ programIds: ['pa1', 'pa2'], spaceIds: ['sa1'] });
    r = await (await patchCode(rec.id, { detach: { programIds: ['pa1'] } })).json();
    expect(r.scope).toEqual({ programIds: ['pa2'], spaceIds: ['sa1'] });
  });

  it('cannot detach the last target (a code that works nowhere is a delete, not an edit)', async () => {
    const rec = await create(A, { programIds: ['pa1'], spaceIds: [] });
    const res = await patchCode(rec.id, { detach: { programIds: ['pa1'] } });
    expect(res.status).toBe(422);
    expect((await db.read()).promoCodes[0]!.scope).toEqual({ programIds: ['pa1'], spaceIds: [] });
  });

  it('cannot attach a foreign or consultant listing', async () => {
    const rec = await create(A, { programIds: ['pa1'], spaceIds: [] });
    for (const bad of [{ programIds: ['pb1'] }, { programIds: ['p-consultant'] }, { spaceIds: ['sb1'] }]) {
      expect((await patchCode(rec.id, { attach: bad })).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await db.read()).promoCodes[0]!.scope).toEqual({ programIds: ['pa1'], spaceIds: [] });
  });

  it('replacing the whole list works and is validated the same way', async () => {
    const rec = await create(A, { programIds: ['pa1'], spaceIds: [] });
    const r = await (await patchCode(rec.id, { programIds: ['pa2'], spaceIds: ['sa2'] })).json();
    expect(r.scope).toEqual({ programIds: ['pa2'], spaceIds: ['sa2'] });
    expect((await patchCode(rec.id, { programIds: ['pb1'] })).status).toBe(422);
  });

  it('replace and attach/detach in one request is refused as ambiguous', async () => {
    const rec = await create(A);
    expect((await patchCode(rec.id, { programIds: ['pa2'], attach: { programIds: ['pa1'] } })).status).toBe(422);
  });

  it('a refused rename leaves the scope untouched too (the store does not roll back a throw)', async () => {
    await createPromoCode({ code: 'OCCUPIED', discountPercent: 5, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    const rec = await create(A, { programIds: ['pa1'], spaceIds: [] });
    const res = await patchCode(rec.id, { code: 'OCCUPIED', attach: { programIds: ['pa2'] }, discountPercent: 99 });
    expect(res.status).toBe(409);
    // Read through the live store, not a copy of the request: this is what the next write would persist.
    const now = (await db.read()).promoCodes.find((c) => c.id === rec.id)!;
    expect(now).toMatchObject({ code: 'RAMADAN20', discountPercent: 20, scope: { programIds: ['pa1'], spaceIds: [] } });
  });

  it('a refused scope leaves the other fields untouched', async () => {
    const rec = await create(A);
    const res = await patchCode(rec.id, { discountPercent: 99, isActive: false, attach: { programIds: ['pb1'] } });
    expect(res.status).toBe(422);
    expect((await db.read()).promoCodes[0]).toMatchObject({ discountPercent: 20, isActive: true });
  });

  it('only the safe fields are editable: owner, appliesTo and usage counters are not', async () => {
    const rec = await create(A);
    for (const extra of [{ ownerIncubatorId: B }, { appliesTo: 'MEMBERSHIP' }, { usedCount: 0 }, { scope: { programIds: ['pb1'], spaceIds: [] } }, { id: 'x' }]) {
      expect((await patchCode(rec.id, extra)).status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('edits to discount, limit, expiry, name and active flag apply', async () => {
    const rec = await create(A);
    const exp = '2031-01-01T00:00:00.000Z';
    const r = await (await patchCode(rec.id, { code: 'newname', discountPercent: 35, usageLimit: 9, expiresAt: exp, isActive: false })).json();
    expect(r).toMatchObject({ code: 'NEWNAME', discountPercent: 35, usageLimit: 9, maxUses: 9, expiresAt: exp, validUntil: exp, isActive: false, ownerIncubatorId: A });
  });

  it('a deactivated incubator code stops working', async () => {
    const rec = await create(A);
    await patchCode(rec.id, { isActive: false });
    const codes = (await db.read()).promoCodes;
    expect(validatePromoCodeSync(codes, 'RAMADAN20', 10_000, 'PROGRAM', await itemOf('PROGRAM', 'pa1')).valid).toBe(false);
  });

  it('once the usage limit is reached the code stops working', async () => {
    const rec = await create(A, { usageLimit: 1 });
    await db.update((d) => { const c = d.promoCodes.find((x) => x.id === rec.id)!; c.usedCount = 1; (c as { useCount?: number }).useCount = 1; });
    const codes = (await db.read()).promoCodes;
    expect(validatePromoCodeSync(codes, 'RAMADAN20', 10_000, 'PROGRAM', await itemOf('PROGRAM', 'pa1')).valid).toBe(false);
  });
});

describe('who may call the incubator routes', () => {
  it.each([
    ['an entrepreneur', { id: 'u2', email: 'e@x.dz', role: 'ENTREPRENEUR' }],
    ['an investor', { id: 'u3', email: 'v@x.dz', role: 'INVESTOR' }],
    ['an admin (they use the admin routes)', admin],
    ['nobody', null],
  ])('%s is refused everywhere and nothing changes', async (_who, user) => {
    const rec = await create(A);
    currentUser = user;
    const statuses = [
      (await (await listRoute()).GET()).status,
      (await postCode({ ...valid, code: 'INTRUDER' })).status,
      (await patchCode(rec.id, { discountPercent: 99 })).status,
      (await delCode(rec.id)).status,
    ];
    for (const s of statuses) expect([401, 403]).toContain(s);
    const codes = (await db.read()).promoCodes;
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ code: 'RAMADAN20', discountPercent: 20 });
  });

  it('an incubator whose account is still pending approval cannot write', async () => {
    const rec = await create(A);
    currentUser = { ...incA, approvalStatus: 'PENDING' };
    expect((await postCode({ ...valid, code: 'PENDING1' })).status).toBe(403);
    expect((await patchCode(rec.id, { discountPercent: 99 })).status).toBe(403);
    expect((await delCode(rec.id)).status).toBe(403);
    expect((await db.read()).promoCodes).toHaveLength(1);
  });

  it('an INCUBATOR user who manages no incubator gets a clean 404, not a crash or someone else\'s data', async () => {
    await create(A);
    currentUser = { id: 'orphan', email: 'orphan@x.dz', role: 'INCUBATOR' };
    expect((await (await listRoute()).GET()).status).toBe(404);
    expect((await postCode(valid)).status).toBe(404);
  });

  it('is resolved by managerId, not by a contact email that two accounts could share', async () => {
    await create(A, { code: 'ACODE' });
    // An attacker account whose EMAIL equals incubator A's contact email, but who does not manage it.
    currentUser = { id: 'impostor', email: 'a@x.dz', role: 'INCUBATOR' };
    expect((await (await listRoute()).GET()).status).toBe(404);
    expect((await postCode({ ...valid, code: 'EVIL' })).status).toBe(404);
  });
});

describe('the admin side stays in charge', () => {
  it('admin can see, deactivate and delete an incubator\'s code', async () => {
    const rec = await create(A);
    currentUser = admin;
    const adminId = await import('@/app/api/admin/promo-codes/[id]/route');
    const list = await (await (await import('@/app/api/admin/promo-codes/route')).GET()).json();
    expect(list.items.map((c: { code: string }) => c.code)).toContain('RAMADAN20');

    expect((await adminId.PATCH(
      new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ isActive: false }) }),
      { params: Promise.resolve({ id: rec.id }) },
    )).status).toBe(200);
    expect((await adminId.DELETE(
      new NextRequest('http://localhost/x', { method: 'DELETE' }),
      { params: Promise.resolve({ id: rec.id }) },
    )).status).toBe(200);
    expect((await db.read()).promoCodes).toHaveLength(0);
  });

  it('an admin edit cannot widen an incubator code: scope is out of the admin schema', async () => {
    const rec = await create(A);
    currentUser = admin;
    const adminId = await import('@/app/api/admin/promo-codes/[id]/route');
    // The admin schema is not strict, so unknown keys are ignored — assert they have NO effect.
    await adminId.PATCH(
      new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ scope: { programIds: ['pb1'], spaceIds: [] }, ownerIncubatorId: null }) }),
      { params: Promise.resolve({ id: rec.id }) },
    );
    expect((await db.read()).promoCodes[0]).toMatchObject({ ownerIncubatorId: A, scope: { programIds: ['pa1'], spaceIds: ['sa1'] } });
  });
});
