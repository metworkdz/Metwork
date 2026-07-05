/**
 * Regression coverage for the two incubator-dashboard breaks:
 *   A) Manual (offline) booking — POST /api/incubator/bookings
 *   B) Add client            — POST /api/incubator/clients
 *
 * Both failed with a generic toast because the request payload diverged from
 * the route's zod schema. These tests pin the contracts the dialogs actually
 * send, plus the persistence/idempotency guarantees.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

// Both routes resolve the incubator from an authenticated INCUBATOR session.
vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'mgr-1', email: 'i@x.com', role: 'INCUBATOR', approvalStatus: 'APPROVED' } });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

// Manual bookings send a receipt email (now awaited) — stub it so the test
// neither hits the network nor depends on its outcome.
vi.mock('@/server/notifications/mock', () => ({
  sendBookingReceiptEmail: vi.fn(),
  sendBookingReceiptEmailAsync: vi.fn(async () => undefined),
}));

function bookingsReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/incubator/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function clientsReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/incubator/clients', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Spaces use real UUIDs (the booking schema enforces spaceId: z.string().uuid()).
const SPACE_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [
      { id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never,
    ];
    d.spaces = [
      {
        id: SPACE_ID, incubatorId: 'inc-1', incubatorName: 'Inc', name: 'Hot Desk',
        city: 'Algiers', isActive: true, capacity: 1, openingTime: '09:00', closingTime: '18:00',
        unavailableDates: [], blackouts: [],
      } as never,
    ];
    d.bookings = [];
    d.clients = [];
    d.users = [{ id: 'mgr-1', email: 'i@x.com', fullName: 'Manager One', role: 'INCUBATOR' } as never];
  });
});

describe('A) manual booking — POST /api/incubator/bookings', () => {
  // The exact payload the manual-booking dialog sends (paymentMethod is the
  // offline-collection label CASH/ONLINE/OTHER, not a wallet method).
  const payload = {
    spaceId: SPACE_ID,
    clientName: 'Walk-in Client',
    clientEmail: 'walkin@x.com',
    startsAt: '2026-07-01T09:00:00.000Z',
    endsAt: '2026-07-01T17:00:00.000Z',
    unit: 'DAY',
    totalAmount: 5000,
    paymentMethod: 'CASH',
    notes: 'paid in cash',
  };

  it('creates a CONFIRMED offline booking from the dialog payload', async () => {
    const { POST } = await import('@/app/api/incubator/bookings/route');
    const res = await POST(bookingsReq(payload));
    expect(res.status).toBe(201);

    const booking = await res.json();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.source).toBe('offline');
    expect(booking.userId).toBeNull();          // not the incubator manager
    expect(booking.paymentMethod).toBe('manual'); // offline settlement
    expect(booking.clientName).toBe('Walk-in Client');
  });

  it('rounds a fractional amount instead of rejecting it', async () => {
    const { POST } = await import('@/app/api/incubator/bookings/route');
    const res = await POST(bookingsReq({ ...payload, totalAmount: 1500.5 }));
    expect(res.status).toBe(201);
    expect((await res.json()).totalAmount).toBe(1501);
  });

  it('lists the booking with the real client name, not the incubator', async () => {
    const { POST, GET } = await import('@/app/api/incubator/bookings/route');
    await POST(bookingsReq(payload));

    const res = await GET();
    const { items } = await res.json();
    expect(items).toHaveLength(1);
    expect(items[0].customerName).toBe('Walk-in Client');
    expect(items[0].customerEmail).toBe('walkin@x.com');
    expect(items[0].status).toBe('CONFIRMED');
  });

  it('is idempotent — a retried identical submit returns the same booking', async () => {
    const { POST } = await import('@/app/api/incubator/bookings/route');
    const first  = await (await POST(bookingsReq(payload))).json();
    const second = await (await POST(bookingsReq(payload))).json();

    expect(second.id).toBe(first.id);
    expect((await db.read()).bookings).toHaveLength(1);
  });
});

describe('B) add client — POST /api/incubator/clients', () => {
  it('creates a name-only client (email & phone optional)', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    const res = await POST(clientsReq({ fullName: 'No Contact' }));
    expect(res.status).toBe(201);

    const client = await res.json();
    expect(client.fullName).toBe('No Contact');
    expect(client.email).toBe('');
    expect(client.phone).toBe('');
    expect(client.incubatorId).toBe('inc-1');
  });

  it('persists the client so the list endpoint returns it immediately', async () => {
    const { POST, GET } = await import('@/app/api/incubator/clients/route');
    await POST(clientsReq({ fullName: 'Visible Client', email: 'v@x.com', phone: '+213500000000' }));

    const res = await GET();
    const { items } = await res.json();
    expect(items.map((c: { fullName: string }) => c.fullName)).toContain('Visible Client');
  });

  it('does not collapse two distinct name-only clients into one', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    await POST(clientsReq({ fullName: 'Client A' }));
    await POST(clientsReq({ fullName: 'Client B' }));
    expect((await db.read()).clients).toHaveLength(2);
  });

  it('stays idempotent on email — same email returns the existing record', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    const a = await (await POST(clientsReq({ fullName: 'Dup', email: 'dup@x.com', phone: '+213500000001' }))).json();
    const b = await (await POST(clientsReq({ fullName: 'Dup Again', email: 'dup@x.com', phone: '+213500000002' }))).json();
    expect(b.id).toBe(a.id);
    expect((await db.read()).clients).toHaveLength(1);
  });
});

describe('C) client billing profile (invoices) — clientType + legal fields', () => {
  it('round-trips the COMPANY billing fields', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    const res = await POST(clientsReq({
      fullName: 'Yacine Benali',
      clientType: 'COMPANY',
      legalName: 'SARL TechNova',
      address: 'Bab Ezzouar, Alger',
      rc: '16/00-1234567B26',
      nif: '002616123456789',
      nis: '002616123456780',
      ai: '16123456789',
    }));
    expect(res.status).toBe(201);
    const client = await res.json();
    expect(client.clientType).toBe('COMPANY');
    expect(client.legalName).toBe('SARL TechNova');
    expect(client.rc).toBe('16/00-1234567B26');
    expect(client.nif).toBe('002616123456789');
    expect(client.nis).toBe('002616123456780');
    expect(client.ai).toBe('16123456789');
  });

  it('rejects a COMPANY without a legalName', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    const res = await POST(clientsReq({ fullName: 'Contact Only', clientType: 'COMPANY' }));
    expect(res.status).toBe(422); // fromZod → 422 VALIDATION_ERROR
  });

  it('defaults clientType from companyName when omitted (legacy callers)', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    const company = await (await POST(clientsReq({ fullName: 'Legacy Co', companyName: 'Old SARL' }))).json();
    expect(company.clientType).toBe('COMPANY');
    const person = await (await POST(clientsReq({ fullName: 'Legacy Person' }))).json();
    expect(person.clientType).toBe('INDIVIDUAL');
  });

  it('PATCH updates the billing fields', async () => {
    const { POST } = await import('@/app/api/incubator/clients/route');
    const { PATCH } = await import('@/app/api/incubator/clients/[id]/route');
    const created = await (await POST(clientsReq({ fullName: 'Amina Cherif' }))).json();

    const req = new NextRequest(`http://localhost/api/incubator/clients/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientType: 'INDIVIDUAL', address: 'Oran', phone: '0770112233' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    const updated = (await db.read()).clients.find((c) => c.id === created.id);
    expect(updated?.clientType).toBe('INDIVIDUAL');
    expect(updated?.address).toBe('Oran');
  });
});
