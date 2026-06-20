/**
 * Part C — incubator cancellation of an UNPAID booking.
 *
 * An incubator may cancel a PENDING_PAYMENT booking (no money ever moved); a
 * paid/settled booking is rejected (ALREADY_PAID) and goes through the existing
 * refund flow instead. The cancel is idempotent and ownership-scoped.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { cancelUnpaidBooking } from '@/server/bookings/incubator-cancel';

const NOW = '2026-06-01T10:00:00.000Z';

function seedBooking(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    userId: null,
    itemKind: 'SPACE',
    itemId: 'space-1',
    itemName: 'Hot Desk',
    vendorName: 'Inc',
    city: 'Algiers',
    unit: 'DAY',
    quantity: 1,
    startsAt: NOW,
    endsAt: NOW,
    totalAmount: 5000,
    status,
    clientReference: 'ref-1',
    clientName: 'Guest Client',
    clientEmail: 'guest@x.com',
    paymentMethod: 'card',
    bookingLocale: 'fr',
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [
      { id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never,
      { id: 'inc-2', name: 'Other', status: 'ACTIVE', managerId: 'mgr-2', email: 'o@x.com' } as never,
    ];
    d.spaces = [
      { id: 'space-1', incubatorId: 'inc-1', incubatorName: 'Inc', name: 'Hot Desk', isActive: true } as never,
    ];
    d.transactions = [];
    d.bookings = [];
  });
});

describe('cancelUnpaidBooking', () => {
  it('cancels an unpaid (PENDING_PAYMENT) booking and moves no money', async () => {
    await db.update((d) => { d.bookings = [seedBooking('PENDING_PAYMENT') as never]; });

    const res = await cancelUnpaidBooking({ bookingId: 'bk-1', managerId: 'mgr-1' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.booking.status).toBe('CANCELLED');
      expect(res.client.email).toBe('guest@x.com');
    }

    const data = await db.read();
    expect(data.bookings.find((b) => b.id === 'bk-1')!.status).toBe('CANCELLED');
    // No refund / payout / clawback — nothing was ever charged.
    expect(data.transactions).toHaveLength(0);
  });

  it('is idempotent — a replay returns ALREADY_FINAL', async () => {
    await db.update((d) => { d.bookings = [seedBooking('PENDING_PAYMENT') as never]; });

    const first = await cancelUnpaidBooking({ bookingId: 'bk-1', managerId: 'mgr-1' });
    expect(first.ok).toBe(true);
    const replay = await cancelUnpaidBooking({ bookingId: 'bk-1', managerId: 'mgr-1' });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('ALREADY_FINAL');

    const data = await db.read();
    expect(data.transactions).toHaveLength(0);
  });

  it('rejects a PAID booking (CONFIRMED) with ALREADY_PAID and leaves it unchanged', async () => {
    await db.update((d) => { d.bookings = [seedBooking('CONFIRMED', { paymentStatus: 'PAID' }) as never]; });

    const res = await cancelUnpaidBooking({ bookingId: 'bk-1', managerId: 'mgr-1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('ALREADY_PAID');

    const data = await db.read();
    expect(data.bookings.find((b) => b.id === 'bk-1')!.status).toBe('CONFIRMED');
    expect(data.transactions).toHaveLength(0);
  });

  it('rejects a wallet escrow (PENDING) booking — that is paid, use the refund flow', async () => {
    await db.update((d) => { d.bookings = [seedBooking('PENDING', { paymentMethod: 'wallet' }) as never]; });

    const res = await cancelUnpaidBooking({ bookingId: 'bk-1', managerId: 'mgr-1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('ALREADY_PAID');
  });

  it("forbids cancelling another incubator's booking", async () => {
    await db.update((d) => { d.bookings = [seedBooking('PENDING_PAYMENT') as never]; });

    const res = await cancelUnpaidBooking({ bookingId: 'bk-1', managerId: 'mgr-2' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('FORBIDDEN');

    const data = await db.read();
    expect(data.bookings.find((b) => b.id === 'bk-1')!.status).toBe('PENDING_PAYMENT');
  });
});
