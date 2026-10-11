/**
 * A space paid from the Metwork wallet settles on the spot.
 *
 * Spaces with no reservation mode set (the legacy default — every production
 * space at the time) wrote a wallet booking PENDING, held in escrow until the
 * incubator pressed a Confirm button the bookings page no longer shows. The
 * client was debited and the host was never paid. INSTANT spaces settled, but
 * at the full amount with no commission, unlike a card payment.
 *
 * Every wallet rail now credits through `incubator-payout.ts`. These assert the
 * ledger, not just the status.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: { id: 'mgr-1', email: 'i@x.dz', role: 'INCUBATOR' } }));
  return { requireApiRole: guard, requireApprovedApiRole: guard, requireApiSession: guard };
});

import { db } from '@/server/db/store';
import { createSpaceBooking } from '@/server/bookings/service';
import { bookingHoldsSeat } from '@/server/bookings/status';

const NOW = '2026-06-01T10:00:00.000Z';
const START = '2030-06-15T09:00:00.000Z';
const END = '2030-06-15T11:00:00.000Z';
const TOTAL = 1000; // 2 h × 500
const COMMISSION = Math.round(TOTAL * 0.05);

async function seed(reservationMode?: 'INSTANT' | 'REQUEST'): Promise<void> {
  await db.update((d) => {
    d.users = [{ id: 'user-1', email: 'u@x.dz', fullName: 'Client', role: 'ENTREPRENEUR', locale: 'fr' } as never];
    d.wallets = [
      { id: 'w-user', userId: 'user-1', balance: 10_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
      { id: 'w-mgr', userId: 'mgr-1', balance: 0, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ];
    d.transactions = [];
    d.bookings = [];
    d.deskBookings = [];
    d.registrations = [];
    d.promoCodes = [];
    d.incubators = [{ id: 'inc-1', name: 'Hub', status: 'ACTIVE', managerId: 'mgr-1' } as never];
    d.spaces = [{
      id: 'space-1', incubatorId: 'inc-1', incubatorName: 'Hub', name: 'Salle', description: 'x',
      category: 'TRAINING_ROOM', city: 'Oran', imageUrl: null, imageUrls: [], pricePerHour: 500,
      pricePerHalfDay: null, pricePerDay: null, pricePerMonth: null, capacity: 1, amenities: [],
      acceptedPaymentMethods: ['ONLINE', 'CASH'], cashDepositType: null, cashDepositValue: null,
      workingDays: [0, 1, 2, 3, 4, 5, 6], openingTime: '00:00', closingTime: '23:59',
      durationDiscounts: [], unavailableDates: [], blackouts: [], isActive: true,
      ...(reservationMode ? { reservationMode } : {}),
      createdAt: NOW, updatedAt: NOW,
    } as never];
  });
}

const book = (ref = 'ref-1') =>
  createSpaceBooking({
    booker: { type: 'user', userId: 'user-1' },
    spaceId: 'space-1',
    unit: 'HOUR',
    startsAt: START,
    endsAt: END,
    clientReference: ref,
    paymentMethod: 'wallet',
  } as never);

const balance = async (id: string) => (await db.read()).wallets.find((w) => w.id === id)!.balance;

describe.each([['unset (legacy)', undefined], ['INSTANT', 'INSTANT' as const]])(
  'wallet space booking — mode %s',
  (_label, mode) => {
    beforeEach(() => seed(mode));

    it('is CONFIRMED at once and the incubator is credited net of commission', async () => {
      const r = await book();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.booking.status).toBe('CONFIRMED');
      expect(r.booking.paymentStatus).toBe('PAID');
      expect(r.booking.commissionAmount).toBe(COMMISSION);
      expect(bookingHoldsSeat(r.booking)).toBe(true);
      expect(await balance('w-user')).toBe(10_000 - TOTAL);
      expect(await balance('w-mgr')).toBe(TOTAL - COMMISSION);
      const mgr = (await db.read()).transactions.filter((t) => t.userId === 'mgr-1').map((t) => [t.type, t.amount]);
      expect(mgr).toEqual([['PAYOUT', TOTAL], ['COMMISSION', -COMMISSION]]);
    });

    it('a replay moves no money twice', async () => {
      await book();
      const again = await book();
      expect(again.ok && again.replayed).toBe(true);
      expect(await balance('w-mgr')).toBe(TOTAL - COMMISSION);
      expect(await balance('w-user')).toBe(10_000 - TOTAL);
    });

    it('a cancel by the incubator refunds the client and leaves the incubator where it started', async () => {
      const r = await book();
      if (!r.ok) throw new Error('expected ok');
      const { PATCH } = await import('@/app/api/incubator/bookings/[id]/route');
      const res = await PATCH(new NextRequest('http://localhost/x', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELLED' }),
      }), { params: Promise.resolve({ id: r.booking.id }) });
      expect(res.status).toBe(200);
      expect(await balance('w-user')).toBe(10_000);
      expect(await balance('w-mgr')).toBe(0);
    });
  },
);

describe('wallet space booking — REQUEST mode', () => {
  beforeEach(() => seed('REQUEST'));

  it('still waits for approval and moves no money at booking time', async () => {
    const r = await book();
    if (!r.ok) throw new Error('expected ok');
    expect(r.booking.status).toBe('AWAITING_APPROVAL');
    expect(await balance('w-user')).toBe(10_000);
    expect(await balance('w-mgr')).toBe(0);
  });
});

describe('wallet space booking — no incubator manager', () => {
  beforeEach(async () => {
    await seed();
    await db.update((d) => { (d.incubators[0] as { managerId: string | null }).managerId = null; });
  });

  it('stays PENDING rather than settling into nobody’s wallet', async () => {
    const r = await book();
    if (!r.ok) throw new Error('expected ok');
    expect(r.booking.status).toBe('PENDING');
    expect((await db.read()).transactions.some((t) => t.type === 'PAYOUT')).toBe(false);
  });
});
