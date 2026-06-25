/**
 * Integration coverage for card-settlement IDEMPOTENCY (the money-critical claim
 * behind the hosted-checkout return, the provider webhook, and the reconcile
 * cron). We drive the webhook entrypoint (`settleCardBookingFromWebhook`, which
 * does not re-poll the provider) twice against the same PENDING_PAYMENT booking:
 *
 *   • first call  → SETTLED: booking CONFIRMED + PAID, settledAt stamped, the
 *     incubator credited once (one PAYOUT, one COMMISSION transaction).
 *   • second call → ALREADY: a pure no-op — no status change, no second credit.
 *
 * Plus: a FAILED webhook is ignored, and an unknown id is NOT_FOUND.
 *
 * Runs against the shared in-memory store (mocked Supabase, see setup.ts); each
 * test reseeds its own incubator + space + booking.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { settleCardBookingFromWebhook } from '@/server/bookings/card-payment';

const INC_ID = 'inc-card-idem';
const MGR_ID = 'mgr-card-idem';
const SPACE_ID = 'sp-card-idem';
const BOOKING_ID = 'bk-card-idem';
const ONLINE = 1600;

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [
      { id: INC_ID, name: 'Idem Incubator', status: 'ACTIVE', managerId: MGR_ID, email: 'idem@x.dz' } as never,
    ];
    d.spaces = [
      {
        id: SPACE_ID, incubatorId: INC_ID, incubatorName: 'Idem Incubator', name: 'Idem Room',
        city: 'Alger', isActive: true, capacity: 20, category: 'COWORKING',
        unavailableDates: [], blackouts: [], workingDays: [0, 1, 2, 3, 4, 5, 6],
        openingTime: '00:00', closingTime: '23:59',
      } as never,
    ];
    d.users = [{ id: MGR_ID, email: 'idem@x.dz', fullName: 'Idem Manager', role: 'INCUBATOR' } as never];
    d.wallets = [];
    d.transactions = [];
    d.bookings = [
      {
        id: BOOKING_ID, userId: null, source: 'online', paymentMethod: 'card',
        itemKind: 'SPACE', itemId: SPACE_ID, itemName: 'Idem Room', vendorName: 'Idem Incubator',
        city: 'Alger', unit: 'HOUR', quantity: 2,
        startsAt: '2026-09-01T09:00:00.000Z', endsAt: '2026-09-01T11:00:00.000Z',
        totalAmount: ONLINE, status: 'PENDING_PAYMENT', clientReference: 'ref-card-idem',
        clientName: 'Idem Client', clientEmail: 'client@x.dz', clientPhone: '+213700000000',
        paymentMode: 'ONLINE_FULL', onlinePaidAmount: ONLINE, cashRemainingAmount: 0,
        settledAt: null, payToken: 'tok-card-idem', bookingLocale: 'fr',
        createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
      } as never,
    ];
  });
});

async function getBooking(id: string) {
  return (await db.read()).bookings.find((b) => b.id === id);
}
async function txnsFor(bookingId: string) {
  const d = await db.read();
  const refs = (d.transactions as Array<{ reference?: string; type?: string }>).filter(
    (t) => t.reference === `payout-${bookingId}` || t.reference === `commission-${bookingId}`,
  );
  return {
    payouts: refs.filter((t) => t.type === 'PAYOUT').length,
    commissions: refs.filter((t) => t.type === 'COMMISSION').length,
  };
}
async function mgrBalance() {
  const w = (await db.read()).wallets.find((x) => x.userId === MGR_ID);
  return w ? w.balance : 0;
}

describe('settleCardBookingFromWebhook — idempotency', () => {
  it('settles exactly once; the replay is a no-op', async () => {
    const first = await settleCardBookingFromWebhook(BOOKING_ID, 'prov-ref-1', 'COMPLETED');
    expect(first).toBe('SETTLED');

    const b1 = await getBooking(BOOKING_ID)!;
    expect(b1!.status).toBe('CONFIRMED');
    expect(b1!.paymentStatus).toBe('PAID');
    expect(b1!.settledAt, 'settledAt stamped').toBeTruthy();

    const creditedOnce = await mgrBalance();
    expect(creditedOnce, 'incubator credited the online base minus commission').toBeGreaterThan(0);
    expect(creditedOnce).toBeLessThanOrEqual(ONLINE);
    expect(await txnsFor(BOOKING_ID)).toEqual({ payouts: 1, commissions: 1 });

    const settledStamp = b1!.settledAt;

    // Replay → ALREADY, and nothing moves.
    const second = await settleCardBookingFromWebhook(BOOKING_ID, 'prov-ref-1', 'COMPLETED');
    expect(second).toBe('ALREADY');

    const b2 = await getBooking(BOOKING_ID)!;
    expect(b2!.settledAt, 'settledAt unchanged on replay').toBe(settledStamp);
    expect(await mgrBalance(), 'no double-credit').toBe(creditedOnce);
    expect(await txnsFor(BOOKING_ID), 'no duplicate transactions').toEqual({ payouts: 1, commissions: 1 });
  });

  it('ignores a FAILED webhook (booking stays PENDING_PAYMENT, no credit)', async () => {
    const res = await settleCardBookingFromWebhook(BOOKING_ID, 'prov-ref-2', 'FAILED');
    expect(res).toBe('IGNORED');

    const b = await getBooking(BOOKING_ID)!;
    expect(b!.status).toBe('PENDING_PAYMENT');
    expect(b!.settledAt ?? null).toBeNull();
    expect(await mgrBalance()).toBe(0);
  });

  it('reports NOT_FOUND for an unknown booking id', async () => {
    const res = await settleCardBookingFromWebhook('does-not-exist', 'prov-ref-3', 'COMPLETED');
    expect(res).toBe('NOT_FOUND');
  });
});
