/**
 * Cancelling — and then deleting — a reservation the host recorded themselves.
 *
 * The bug: a manual coworking reservation is saved CONFIRMED, which holds its
 * desk, and a booking that holds a seat cannot be deleted. The server said
 * "cancel it first" and no screen anywhere had a button that cancelled it.
 *
 * These tests treat the new cancel endpoint as the thing a hostile or careless
 * caller would poke at: someone else's booking, a booking that was paid online
 * (which moves real ledger entries), one already cancelled, an admin session,
 * a signed-out one. The happy path is the short part.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Actor = { id: string; email: string; role: string; approvalStatus?: string };
const hostA: Actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
const hostB: Actor = { id: 'mgr-b', email: 'b@x.dz', role: 'INCUBATOR' };
let currentUser: Actor | null = hostA;

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
      if (g.user.approvalStatus === 'PENDING') return { ok: false as const, response: new Response('pending', { status: 403 }) };
      return g;
    }),
  };
});

const sendCancelled = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/server/notifications/mock', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendBookingProviderCancelledEmail: (...a: unknown[]) => sendCancelled(...a),
}));
const createNotification = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/server/notifications/create-notification', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

import { db } from '@/server/db/store';
import { bookingCanBeDeleted, manualBookingCanBeCancelled, bookingIsManual } from '@/server/bookings/status';
import { checkSpaceAvailability } from '@/server/bookings/availability';
import { holdDeskForBooking } from '@/server/spaces/availability';

const NOW = '2026-09-01T00:00:00.000Z';
const A = 'inc-a';
const B = 'inc-b';
const START = '2030-06-10T00:00:00.000Z';
const END = '2030-06-12T00:00:00.000Z';

function booking(id: string, over: Record<string, unknown> = {}) {
  return {
    id, userId: null, source: 'offline', itemKind: 'SPACE', itemId: 'space-a', itemName: 'Open space',
    vendorName: 'A', city: 'Oran', unit: 'DAY', quantity: 2, startsAt: START, endsAt: END, totalAmount: 6000,
    status: 'CONFIRMED', clientReference: `ref-${id}`, transactionId: null, paymentMethod: 'manual',
    clientName: 'Karim B', clientEmail: 'karim@example.dz', createdAt: NOW, updatedAt: NOW, ...over,
  } as never;
}

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.wallets = []; d.transactions = []; d.registrations = []; d.bookings = []; d.deskBookings = [];
    d.incubators = [
      { id: A, name: 'A', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz', createdAt: NOW, updatedAt: NOW } as never,
      { id: B, name: 'B', city: 'Alger', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.spaces = [{
      id: 'space-a', incubatorId: A, incubatorName: 'A', name: 'Open space', category: 'COWORKING', city: 'Oran',
      deskNames: ['D1', 'D2'], capacity: 2, pricePerDay: 3000, isActive: true, workingDays: [0, 1, 2, 3, 4, 5, 6],
      openingTime: '00:00', closingTime: '23:59', unavailableDates: [], blackouts: [], durationDiscounts: [],
      createdAt: NOW, updatedAt: NOW,
    } as never];
    d.bookings = [
      booking('bk-manual'),                                                     // the user's case
      booking('bk-card', { source: 'online', paymentMethod: 'card', userId: 'u1', paymentStatus: 'PAID', onlinePaidAmount: 6000 }),
      booking('bk-wallet', { source: 'online', paymentMethod: 'wallet', userId: 'u1', transactionId: 'tx-1' }),
      booking('bk-cancelled', { status: 'CANCELLED' }),
      booking('bk-unpaid', { status: 'PENDING_PAYMENT' }),
      booking('bk-noemail', { clientEmail: null }),
    ];
    d.wallets = [{ id: 'w1', userId: 'u1', balance: 1000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never];
    holdDeskForBooking(d.deskBookings, {
      spaceId: 'space-a', incubatorId: A, deskName: 'D1', startsAt: START, endsAt: END,
      userId: null, clientName: 'Karim B', clientPhone: null, bookingId: 'bk-manual', source: 'offline',
    });
  });
  currentUser = hostA;
  sendCancelled.mockClear();
  createNotification.mockClear();
}

beforeEach(seed);

const idRoute = async () => import('@/app/api/incubator/bookings/[id]/route');
const cancelRoute = async () => import('@/app/api/incubator/bookings/[id]/cancel-reservation/route');
const cancel = async (id: string, qs = '') =>
  (await cancelRoute()).POST(
    new NextRequest(`http://localhost/api/incubator/bookings/${id}/cancel-reservation${qs}`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );
const del = async (id: string) =>
  (await idRoute()).DELETE(new NextRequest(`http://localhost/api/incubator/bookings/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
const get = async (id: string) => (await db.read()).bookings.find((b) => b.id === id)!;

describe('the reported problem: cancel first, then delete', () => {
  it('delete is refused while the reservation holds its desk (the message the host saw)', async () => {
    const res = await del('bk-manual');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('HOLDS_SEAT');
    expect((await get('bk-manual')).deletedAt).toBeFalsy();
  });

  it('cancel releases the reservation, then delete works', async () => {
    expect((await cancel('bk-manual')).status).toBe(200);
    expect((await get('bk-manual')).status).toBe('CANCELLED');
    expect((await del('bk-manual')).status).toBe(200);
    expect((await get('bk-manual')).deletedAt).toBeTruthy();
  });

  it('frees the desk: it is blocked before and bookable after', async () => {
    const before = (await db.read()).deskBookings.filter((x) => x.bookingId === 'bk-manual');
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((x) => x.status !== 'CANCELLED')).toBe(true);

    await cancel('bk-manual');

    const after = (await db.read()).deskBookings.filter((x) => x.bookingId === 'bk-manual');
    expect(after.every((x) => x.status === 'CANCELLED')).toBe(true);
    // A new hold on the same desk and days now succeeds, instead of conflicting.
    const d = await db.read();
    const again = holdDeskForBooking(d.deskBookings, {
      spaceId: 'space-a', incubatorId: A, deskName: 'D1', startsAt: START, endsAt: END,
      userId: null, clientName: 'Someone else', clientPhone: null, bookingId: 'bk-new', source: 'offline',
    });
    expect(again.ok).toBe(true);
  });

  it('frees the slot for the shared availability gate too', async () => {
    // Only this booking on the slot, so the gate's answer is down to it alone.
    await db.update((d) => { d.bookings = d.bookings.filter((b) => b.id === 'bk-manual'); d.spaces[0]!.capacity = 1; });
    const gate = async () => {
      const d = await db.read();
      return checkSpaceAvailability({ space: d.spaces[0]!, bookings: d.bookings, spaceId: 'space-a', unit: 'DAY', startsAt: START, endsAt: END }).ok;
    };
    expect(await gate()).toBe(false);
    await cancel('bk-manual');
    expect(await gate()).toBe(true);
  });

  it('moves no money: wallets and ledger are byte-for-byte unchanged', async () => {
    const before = JSON.stringify([(await db.read()).wallets, (await db.read()).transactions]);
    await cancel('bk-manual');
    expect(JSON.stringify([(await db.read()).wallets, (await db.read()).transactions])).toBe(before);
  });

  it('a replay is a clean 409 and changes nothing further', async () => {
    await cancel('bk-manual');
    const stamp = (await get('bk-manual')).updatedAt;
    const again = await cancel('bk-manual');
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('ALREADY_FINAL');
    expect((await get('bk-manual')).updatedAt).toBe(stamp);
  });

  it('cancels the registration built from a program booking too (one seat, two rows)', async () => {
    await db.update((d) => {
      d.programs = [{ id: 'prog-a', incubatorId: A, title: 'P' } as never];
      d.bookings.push(booking('bk-prog', { itemKind: 'PROGRAM', itemId: 'prog-a' }));
      d.registrations = [{ id: 'reg-1', bookingId: 'bk-prog', status: 'CONFIRMED', entityType: 'PROGRAM', entityId: 'prog-a', email: 'k@x.dz', fullName: 'K', createdAt: NOW, updatedAt: NOW } as never];
    });
    expect((await cancel('bk-prog')).status).toBe(200);
    expect((await db.read()).registrations[0]!.status).toBe('CANCELLED');
  });
});

describe('what it refuses', () => {
  it('a booking paid online is refused and untouched — it reverses real wallet entries elsewhere', async () => {
    for (const id of ['bk-card', 'bk-wallet']) {
      const before = JSON.stringify(await get(id));
      const res = await cancel(id);
      expect(res.status, id).toBe(409);
      expect((await res.json()).error.code).toBe('NOT_MANUAL');
      expect(JSON.stringify(await get(id))).toBe(before);
    }
    expect((await db.read()).wallets[0]!.balance).toBe(1000);
  });

  it('an unpaid reservation is not cancelled here (it has its own control and holds no seat)', async () => {
    const res = await cancel('bk-unpaid');
    expect(res.status).toBe(409);
    expect((await get('bk-unpaid')).status).toBe('PENDING_PAYMENT');
  });

  it('someone else\'s booking answers exactly like a missing one, and is untouched', async () => {
    currentUser = hostB;
    const foreign = await cancel('bk-manual');
    const missing = await cancel('no-such-booking');
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(await foreign.json()).toEqual(await missing.json());
    expect((await get('bk-manual')).status).toBe('CONFIRMED');
    expect((await db.read()).deskBookings.some((x) => x.bookingId === 'bk-manual' && x.status !== 'CANCELLED')).toBe(true);
  });

  it.each([
    ['an admin session (no incubator to act as)', { id: 'adm', email: 'adm@x.dz', role: 'ADMIN' }],
    ['an entrepreneur', { id: 'u9', email: 'e@x.dz', role: 'ENTREPRENEUR' }],
    ['nobody', null],
  ])('%s is refused', async (_w, user) => {
    currentUser = user;
    expect([401, 403]).toContain((await cancel('bk-manual')).status);
    expect((await get('bk-manual')).status).toBe('CONFIRMED');
  });

  it('an account still pending approval cannot cancel', async () => {
    currentUser = { ...hostA, approvalStatus: 'PENDING' };
    expect((await cancel('bk-manual')).status).toBe(403);
    expect((await get('bk-manual')).status).toBe('CONFIRMED');
  });

  it('a host with no incubator gets a clean 404', async () => {
    currentUser = { id: 'orphan', email: 'o@x.dz', role: 'INCUBATOR' };
    expect((await cancel('bk-manual')).status).toBe(404);
  });
});

describe('telling the client is opt-in', () => {
  it('is silent by default', async () => {
    await cancel('bk-manual');
    expect(sendCancelled).not.toHaveBeenCalled();
  });

  it('?notify=true emails once, with the booking details', async () => {
    await cancel('bk-manual', '?notify=true');
    expect(sendCancelled).toHaveBeenCalledTimes(1);
    expect(sendCancelled.mock.calls[0]![0]).toBe('karim@example.dz');
    expect(sendCancelled.mock.calls[0]![1]).toMatchObject({ bookingId: 'bk-manual', itemName: 'Open space' });
  });

  it('?notify=true with no address on file sends nothing and still cancels', async () => {
    expect((await cancel('bk-noemail', '?notify=true')).status).toBe(200);
    expect(sendCancelled).not.toHaveBeenCalled();
  });

  it('a refused cancel never emails anyone', async () => {
    await cancel('bk-card', '?notify=true');
    currentUser = hostB;
    await cancel('bk-manual', '?notify=true');
    expect(sendCancelled).not.toHaveBeenCalled();
  });

  it('never echoes a payment-link credential', async () => {
    const body = await (await cancel('bk-manual')).json();
    expect(JSON.stringify(body)).not.toMatch(/paymentLinkTokenHash/);
  });
});

describe('the predicates behind the buttons', () => {
  const st = (status: string, over: Record<string, unknown> = {}) => ({ status, source: 'offline', paymentMethod: 'manual', ...over }) as never;

  it('only a manual booking that holds a seat is cancellable here', () => {
    expect(manualBookingCanBeCancelled(st('CONFIRMED'))).toBe(true);
    expect(manualBookingCanBeCancelled(st('PENDING'))).toBe(true);
    for (const s of ['CANCELLED', 'REFUNDED', 'PENDING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED_UNPAID']) {
      expect(manualBookingCanBeCancelled(st(s)), s).toBe(false);
    }
    expect(manualBookingCanBeCancelled(st('CONFIRMED', { source: 'online', paymentMethod: 'card' }))).toBe(false);
    expect(manualBookingCanBeCancelled(st('CONFIRMED', { source: 'online', paymentMethod: 'wallet' }))).toBe(false);
  });

  it('every state the host can cancel from is a state they could not delete from (no dead end remains)', () => {
    for (const s of ['CONFIRMED', 'PENDING']) {
      const b = st(s);
      expect(bookingCanBeDeleted(b)).toBe(false);
      expect(manualBookingCanBeCancelled(b)).toBe(true);
    }
  });

  it('bookingIsManual matches either marker', () => {
    expect(bookingIsManual({ source: 'offline' })).toBe(true);
    expect(bookingIsManual({ paymentMethod: 'manual' })).toBe(true);
    expect(bookingIsManual({ source: 'online', paymentMethod: 'card' })).toBe(false);
  });
});
