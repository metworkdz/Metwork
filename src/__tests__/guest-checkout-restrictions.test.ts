/**
 * Part A — guest checkout is restricted to PROGRAMS only. Spaces, events and
 * consultations require a Metwork account: an anonymous request is rejected with
 * 401 at the route layer, while a guest program booking still goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { guestCheckoutAllowedFor } from '@/server/bookings/status';

// ── Mocks: isolate the route guard from session / rate-limit / DB. ──────────
vi.mock('@/server/auth/session', () => ({
  readSession: vi.fn(async () => null), // guest
}));
vi.mock('@/lib/session', () => ({
  getServerSession: vi.fn(async () => null), // guest
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitDistributed: vi.fn(async () => true),
}));
const createCardBookingIntent = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  replayed: false,
  booking: { bookingLocale: 'fr' },
  token: 'tok-123',
}));
vi.mock('@/server/bookings/card-payment', () => ({
  createCardBookingIntent: (...args: unknown[]) => createCardBookingIntent(...args),
}));
const createInstantBooking = vi.fn((..._args: unknown[]) => undefined);
vi.mock('@/server/consultations/instant-book', () => ({
  isInstantBookEnabled: () => true,
  createInstantBooking: (...args: unknown[]) => createInstantBooking(...args),
}));

const customer = { fullName: 'Guest User', email: 'guest@x.com', phone: '+213500000000' };

function cardReq(target: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/bookings/card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target, paymentMode: 'ONLINE_FULL', customer, clientReference: 'ref-12345678' }),
  });
}

beforeEach(() => {
  createCardBookingIntent.mockClear();
  createInstantBooking.mockClear();
});

describe('guestCheckoutAllowedFor', () => {
  it('allows guests only for programs', () => {
    expect(guestCheckoutAllowedFor('PROGRAM')).toBe(true);
    expect(guestCheckoutAllowedFor('SPACE')).toBe(false);
    expect(guestCheckoutAllowedFor('EVENT')).toBe(false);
  });
});

describe('POST /api/bookings/card — guest gate', () => {
  it('forces login for a guest SPACE booking (401, never creates an intent)', async () => {
    const { POST } = await import('@/app/api/bookings/card/route');
    const res = await POST(cardReq({ itemKind: 'SPACE', spaceId: 's1', unit: 'DAY', startsAt: '2026-07-01T09:00:00Z', endsAt: '2026-07-01T17:00:00Z' }));
    expect(res.status).toBe(401);
    expect(createCardBookingIntent).not.toHaveBeenCalled();
  });

  it('forces login for a guest EVENT booking (401)', async () => {
    const { POST } = await import('@/app/api/bookings/card/route');
    const res = await POST(cardReq({ itemKind: 'EVENT', eventId: 'e1' }));
    expect(res.status).toBe(401);
    expect(createCardBookingIntent).not.toHaveBeenCalled();
  });

  it('lets a guest book a PROGRAM (reaches intent creation)', async () => {
    const { POST } = await import('@/app/api/bookings/card/route');
    const res = await POST(cardReq({ itemKind: 'PROGRAM', programId: 'p1' }));
    expect(res.status).toBe(201);
    expect(createCardBookingIntent).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/mentors/[id]/instant-book — guest gate', () => {
  it('forces login for a guest consultation (401, never creates a booking)', async () => {
    const { POST } = await import('@/app/api/mentors/[id]/instant-book/route');
    const req = new NextRequest('http://localhost/api/mentors/m1/instant-book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Guest User',
        email: 'guest@x.com',
        phone: '+213500000000',
        message: 'I would like a consultation please',
        durationMinutes: 60,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'm1' }) });
    expect(res.status).toBe(401);
    expect(createInstantBooking).not.toHaveBeenCalled();
  });
});
