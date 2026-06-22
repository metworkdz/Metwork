/**
 * Coverage for incubator edit/delete of MANUAL (offline) bookings:
 *   PUT    /api/incubator/bookings/:id  — edit fields + re-check availability
 *   DELETE /api/incubator/bookings/:id  — remove the booking
 *
 * Both are scoped to manual/offline bookings (no wallet/ledger movement) and
 * fire a client email. We assert the contract, the manual-only guard, the
 * self-excluding availability re-check, and that the client email is sent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'mgr-1', email: 'i@x.com', role: 'INCUBATOR', approvalStatus: 'APPROVED' } });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

// Stub the awaited client emails so tests neither hit the network nor depend on
// PDF generation, while still letting us assert they were invoked.
const sendBookingUpdatedEmail = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
const sendBookingProviderCancelledEmail = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock('@/server/notifications/mock', () => ({
  sendBookingConfirmedWithQrEmail: vi.fn(),
  sendBookingDeclinedEmail: vi.fn(),
  sendBookingUpdatedEmail: (...a: unknown[]) => sendBookingUpdatedEmail(...a),
  sendBookingProviderCancelledEmail: (...a: unknown[]) => sendBookingProviderCancelledEmail(...a),
}));

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const MANUAL_ID = 'bk-manual-1';
const ONLINE_ID = 'bk-online-1';

function req(id: string, method: 'PUT' | 'DELETE', body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/incubator/bookings/${id}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const editBody = {
  startsAt: '2026-07-02T09:00:00.000Z',
  endsAt: '2026-07-02T12:00:00.000Z',
  unit: 'HOUR',
  totalAmount: 3000,
  clientName: 'Walk-in Edited',
  clientEmail: 'walkin@x.com',
  notes: 'rescheduled',
};

beforeEach(async () => {
  sendBookingUpdatedEmail.mockClear();
  sendBookingProviderCancelledEmail.mockClear();
  await db.update((d) => {
    d.incubators = [
      { id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never,
    ];
    d.spaces = [
      {
        id: SPACE_ID, incubatorId: 'inc-1', incubatorName: 'Inc', name: 'Hot Desk',
        city: 'Algiers', isActive: true, capacity: 1,
        workingDays: [0, 1, 2, 3, 4, 5, 6], openingTime: '00:00', closingTime: '23:59',
        unavailableDates: [], blackouts: [], durationDiscounts: [],
      } as never,
    ];
    d.users = [{ id: 'mgr-1', email: 'i@x.com', fullName: 'Manager One', role: 'INCUBATOR' } as never];
    d.bookings = [
      {
        id: MANUAL_ID, userId: null, source: 'offline', itemKind: 'SPACE', itemId: SPACE_ID,
        itemName: 'Hot Desk', vendorName: 'Inc', city: 'Algiers', unit: 'DAY', quantity: 1,
        startsAt: '2026-07-01T09:00:00.000Z', endsAt: '2026-07-01T17:00:00.000Z',
        totalAmount: 5000, status: 'CONFIRMED', clientReference: 'ref-1', transactionId: null,
        paymentMethod: 'manual', clientName: 'Walk-in', clientEmail: 'walkin@x.com', notes: null,
        createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z',
      } as never,
      {
        id: ONLINE_ID, userId: 'u-2', source: 'online', itemKind: 'SPACE', itemId: SPACE_ID,
        itemName: 'Hot Desk', vendorName: 'Inc', city: 'Algiers', unit: 'HOUR', quantity: 2,
        startsAt: '2026-08-01T09:00:00.000Z', endsAt: '2026-08-01T11:00:00.000Z',
        totalAmount: 2000, status: 'CONFIRMED', clientReference: 'ref-2', transactionId: 'tx-1',
        paymentMethod: 'wallet', createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z',
      } as never,
    ];
  });
});

describe('PUT — edit manual booking', () => {
  it('updates fields, recomputes quantity, and emails the client', async () => {
    const { PUT } = await import('@/app/api/incubator/bookings/[id]/route');
    const res = await PUT(req(MANUAL_ID, 'PUT', editBody), ctx(MANUAL_ID));
    expect(res.status).toBe(200);

    const stored = (await db.read()).bookings.find((b) => b.id === MANUAL_ID)!;
    expect(stored.startsAt).toBe(editBody.startsAt);
    expect(stored.totalAmount).toBe(3000);
    expect(stored.unit).toBe('HOUR');
    expect(stored.quantity).toBe(3);           // 3 hours
    expect(stored.notes).toBe('rescheduled');
    expect(sendBookingUpdatedEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects editing a non-manual (online) booking with 409', async () => {
    const { PUT } = await import('@/app/api/incubator/bookings/[id]/route');
    const res = await PUT(req(ONLINE_ID, 'PUT', editBody), ctx(ONLINE_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NOT_EDITABLE');
  });

  it('re-check excludes the booking itself (no self-conflict on a capacity-1 space)', async () => {
    const { PUT } = await import('@/app/api/incubator/bookings/[id]/route');
    // Move it within the same day — would "overlap itself" if not excluded.
    const res = await PUT(req(MANUAL_ID, 'PUT', { ...editBody, startsAt: '2026-07-01T10:00:00.000Z', endsAt: '2026-07-01T12:00:00.000Z' }), ctx(MANUAL_ID));
    expect(res.status).toBe(200);
  });
});

describe('DELETE — remove manual booking', () => {
  it('removes the booking and emails the client', async () => {
    const { DELETE } = await import('@/app/api/incubator/bookings/[id]/route');
    const res = await DELETE(req(MANUAL_ID, 'DELETE'), ctx(MANUAL_ID));
    expect(res.status).toBe(200);
    expect((await db.read()).bookings.find((b) => b.id === MANUAL_ID)).toBeUndefined();
    expect(sendBookingProviderCancelledEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects deleting a non-manual (online) booking with 409', async () => {
    const { DELETE } = await import('@/app/api/incubator/bookings/[id]/route');
    const res = await DELETE(req(ONLINE_ID, 'DELETE'), ctx(ONLINE_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NOT_DELETABLE');
    expect((await db.read()).bookings.find((b) => b.id === ONLINE_ID)).toBeDefined();
  });

  it('returns 404 on a second delete (idempotent from the client view)', async () => {
    const { DELETE } = await import('@/app/api/incubator/bookings/[id]/route');
    await DELETE(req(MANUAL_ID, 'DELETE'), ctx(MANUAL_ID));
    const res = await DELETE(req(MANUAL_ID, 'DELETE'), ctx(MANUAL_ID));
    expect(res.status).toBe(404);
  });
});
