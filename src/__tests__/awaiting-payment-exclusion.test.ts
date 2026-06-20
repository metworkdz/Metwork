/**
 * Part B — awaiting-payment (PENDING_PAYMENT) bookings hold NO seat and count
 * toward NO financial figure until they settle. The exclusion rule is shared
 * (src/server/bookings/status.ts) so seat-hold, attendance and revenue can never
 * diverge.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { isAwaitingPayment, bookingCountsAsRevenue } from '@/server/bookings/status';
import { countAttendance } from '@/server/attendance';
import { checkSpaceAvailability } from '@/server/bookings/availability';

// Revenue route reads an authenticated incubator — stub the guard.
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () => ({
    ok: true,
    user: { id: 'mgr-1', email: 'i@x.com', role: 'INCUBATOR' },
  })),
}));

const THIS_MONTH = `${new Date().toISOString().slice(0, 7)}-15T10:00:00.000Z`;

function booking(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: null,
    itemKind: 'SPACE',
    itemId: 'space-1',
    itemName: 'Hot Desk',
    vendorName: 'Inc',
    city: 'Algiers',
    unit: 'DAY',
    quantity: 1,
    startsAt: '2026-07-01T09:00:00.000Z',
    endsAt: '2026-07-01T17:00:00.000Z',
    totalAmount: 5000,
    status,
    clientReference: `ref-${id}`,
    clientEmail: `${id}@x.com`,
    paymentMethod: 'card',
    createdAt: THIS_MONTH,
    updatedAt: THIS_MONTH,
    ...extra,
  };
}

describe('shared status predicates', () => {
  it('isAwaitingPayment is true only for PENDING_PAYMENT', () => {
    expect(isAwaitingPayment({ status: 'PENDING_PAYMENT' })).toBe(true);
    expect(isAwaitingPayment({ status: 'CONFIRMED' })).toBe(false);
    expect(isAwaitingPayment({ status: 'PENDING' })).toBe(false);
  });

  it('bookingCountsAsRevenue excludes CANCELLED, REFUNDED and PENDING_PAYMENT', () => {
    expect(bookingCountsAsRevenue({ status: 'CONFIRMED' })).toBe(true);
    expect(bookingCountsAsRevenue({ status: 'COMPLETED' })).toBe(true);
    expect(bookingCountsAsRevenue({ status: 'PENDING' })).toBe(true);
    expect(bookingCountsAsRevenue({ status: 'PENDING_PAYMENT' })).toBe(false);
    expect(bookingCountsAsRevenue({ status: 'CANCELLED' })).toBe(false);
    expect(bookingCountsAsRevenue({ status: 'REFUNDED' })).toBe(false);
  });
});

describe('seat hold — programs/events (countAttendance)', () => {
  it('a PENDING_PAYMENT booking holds no seat until it settles', () => {
    const bookings: { id: string; itemKind: string; itemId: string; status: string; userId: string | null; clientEmail: string }[] = [
      { id: 'p1', itemKind: 'PROGRAM', itemId: 'prog-1', status: 'CONFIRMED', userId: null, clientEmail: 'a@x.com' },
      { id: 'p2', itemKind: 'PROGRAM', itemId: 'prog-1', status: 'PENDING_PAYMENT', userId: null, clientEmail: 'b@x.com' },
    ];
    const data = { bookings, registrations: [] } as never;
    expect(countAttendance(data, 'PROGRAM', 'prog-1')).toBe(1);

    // Settle the awaiting-payment booking → it now occupies a seat.
    bookings[1]!.status = 'CONFIRMED';
    expect(countAttendance(data, 'PROGRAM', 'prog-1')).toBe(2);
  });
});

describe('seat hold — spaces (checkSpaceAvailability)', () => {
  const space = { capacity: 1, unavailableDates: [], blackouts: [] };
  const window = { spaceId: 'space-1', unit: 'DAY' as const, startsAt: '2026-07-01T09:00:00.000Z', endsAt: '2026-07-01T17:00:00.000Z' };

  it('a PENDING_PAYMENT booking does not block the slot; a CONFIRMED one does', () => {
    const pending = [booking('b1', 'PENDING_PAYMENT')] as never;
    expect(checkSpaceAvailability({ space, bookings: pending, ...window }).ok).toBe(true);

    const confirmed = [booking('b1', 'CONFIRMED')] as never;
    const res = checkSpaceAvailability({ space, bookings: confirmed, ...window });
    expect(res.ok).toBe(false);
  });
});

describe('incubator revenue route — financial figures', () => {
  beforeEach(async () => {
    await db.update((d) => {
      d.incubators = [
        { id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never,
      ];
      d.spaces = [
        { id: 'space-1', incubatorId: 'inc-1', incubatorName: 'Inc', name: 'Hot Desk', isActive: true } as never,
      ];
      d.bookings = [
        booking('paid', 'CONFIRMED', { commissionAmount: 250 }) as never,
        booking('unpaid', 'PENDING_PAYMENT', { totalAmount: 9999 }) as never,
      ];
    });
  });

  it('excludes awaiting-payment from gross, net and this-month figures', async () => {
    const { GET } = await import('@/app/api/incubator/revenue/route');
    const res = await GET();
    const body = await res.json();

    // Only the CONFIRMED 5000 counts — the 9999 awaiting-payment intent is out.
    expect(body.totals.gross).toBe(5000);
    expect(body.totals.net).toBe(5000 - 250);
    expect(body.mtd.gross).toBe(5000);
    expect(body.totals.bookings).toBe(1);
  });
});
