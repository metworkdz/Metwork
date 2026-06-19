/**
 * Tests for webhook-driven settlement (P2-3) — the path that recovers a payer
 * who completes the hosted checkout but never returns to the pay page. These
 * settle by the provider `external_id` (= booking.id), with no re-poll, since
 * the webhook is signature-verified upstream.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { settleGuestConsultationFromWebhook } from '@/server/consultations/guest-payment';
import { settleCardBookingFromWebhook } from '@/server/bookings/card-payment';

const NOW = '2026-06-01T10:00:00.000Z';
const TOMORROW = new Date(Date.now() + 3 * 86_400_000).toISOString();

describe('settleGuestConsultationFromWebhook', () => {
  beforeEach(async () => {
    await db.update((d) => {
      d.mentorBookings = [
        {
          id: 'mb-1',
          mentorId: 'mentor-1',
          userId: null,
          source: 'guest',
          instantBook: false,
          userName: 'Guest',
          userEmail: 'g@x.com',
          userPhone: '+213500000000',
          message: 'hello there',
          status: 'PENDING_PAYMENT',
          paymentStatus: 'AWAITING_PAYMENT',
          guestAmountDue: 4000,
          amountCharged: 4000,
          payToken: 'tok-1',
          payTokenExpiresAt: TOMORROW,
          paymentProviderRef: 'slick-ref-1',
          guestLocale: 'fr',
          createdAt: NOW,
          updatedAt: NOW,
        } as never,
      ];
    });
  });

  it('settles a paid guest consultation by external_id', async () => {
    const r = await settleGuestConsultationFromWebhook('mb-1', 'slick-ref-1', 'COMPLETED');
    expect(r).toBe('SETTLED');
    const data = await db.read();
    const b = data.mentorBookings!.find((x) => x.id === 'mb-1')!;
    expect(b.paymentStatus).toBe('PAID');
    expect(b.status).toBe('CONFIRMED');
  });

  it('is idempotent on replay', async () => {
    await settleGuestConsultationFromWebhook('mb-1', 'slick-ref-1', 'COMPLETED');
    const r2 = await settleGuestConsultationFromWebhook('mb-1', 'slick-ref-1', 'COMPLETED');
    expect(r2).toBe('ALREADY');
  });

  it('ignores a FAILED event (leaves booking unpaid)', async () => {
    const r = await settleGuestConsultationFromWebhook('mb-1', 'slick-ref-1', 'FAILED');
    expect(r).toBe('IGNORED');
    const data = await db.read();
    expect(data.mentorBookings![0]!.paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    const r = await settleGuestConsultationFromWebhook('nope', null, 'COMPLETED');
    expect(r).toBe('NOT_FOUND');
  });
});

describe('settleCardBookingFromWebhook', () => {
  beforeEach(async () => {
    await db.update((d) => {
      d.incubators = [
        { id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never,
      ];
      d.spaces = [
        {
          id: 'space-1', incubatorId: 'inc-1', incubatorName: 'Inc', name: 'Room', isActive: true,
          capacity: 3, unavailableDates: [], blackouts: [],
          pricePerHour: 1000, pricePerDay: null, pricePerMonth: null,
          acceptedPaymentMethods: ['ONLINE'], workingDays: [0,1,2,3,4,5,6],
          openingTime: '00:00', closingTime: '23:59', durationDiscounts: [],
        } as never,
      ];
      d.wallets = [];
      d.transactions = [];
      d.bookings = [
        {
          id: 'cb-1', userId: null, source: 'online', paymentMethod: 'card',
          itemKind: 'SPACE', itemId: 'space-1', itemName: 'Room', vendorName: 'Inc', city: 'Algiers',
          unit: 'HOUR', quantity: 2, startsAt: '2026-06-15T09:00:00.000Z', endsAt: '2026-06-15T11:00:00.000Z',
          totalAmount: 2000, status: 'PENDING_PAYMENT', clientReference: 'r1',
          paymentMode: 'ONLINE_FULL', onlinePaidAmount: 2000, cashRemainingAmount: 0,
          onlineChargeAmount: 2040, settledAt: null, payToken: 'ctok-1',
          payTokenExpiresAt: TOMORROW, paymentProviderRef: 'slick-ref-2', bookingLocale: 'fr',
          createdAt: NOW, updatedAt: NOW,
        } as never,
      ];
    });
  });

  it('settles a paid card booking by external_id', async () => {
    const r = await settleCardBookingFromWebhook('cb-1', 'slick-ref-2', 'COMPLETED');
    expect(r).toBe('SETTLED');
    const data = await db.read();
    const b = data.bookings.find((x) => x.id === 'cb-1')!;
    expect(b.status).toBe('CONFIRMED');
    expect(b.paymentStatus).toBe('PAID');
    expect(b.settledAt).toBeTruthy();
    // Incubator manager credited the online amount.
    const wallet = data.wallets.find((w) => w.userId === 'mgr-1');
    expect(wallet).toBeTruthy();
  });

  it('is idempotent on replay', async () => {
    await settleCardBookingFromWebhook('cb-1', 'slick-ref-2', 'COMPLETED');
    const r2 = await settleCardBookingFromWebhook('cb-1', 'slick-ref-2', 'COMPLETED');
    expect(r2).toBe('ALREADY');
  });

  it('ignores a FAILED event and returns NOT_FOUND for unknown ids', async () => {
    expect(await settleCardBookingFromWebhook('cb-1', null, 'FAILED')).toBe('IGNORED');
    expect(await settleCardBookingFromWebhook('zzz', null, 'COMPLETED')).toBe('NOT_FOUND');
  });
});
