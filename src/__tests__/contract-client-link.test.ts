/**
 * A client's contract must carry THEIR ID number and address.
 *
 * The bug: the manual-booking dialog threw away the client picked from the
 * client book and saved only a name and an email. The booking therefore had no
 * link to the book entry that holds the ID number and address, `{{client_id_number}}`
 * printed blank, and `{{client_address}}` did not exist at all.
 *
 * The output is a legal document, so half of this file is about the opposite
 * failure: printing somebody ELSE'S ID number. Every matching rule is tested
 * for the case where it must refuse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Actor = { id: string; email: string; role: string };
const hostA: Actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
const hostB: Actor = { id: 'mgr-b', email: 'b@x.dz', role: 'INCUBATOR' };
let currentUser: Actor | null = hostA;

vi.mock('@/server/auth/api-guards', () => {
  const base = async (roles: string[]) => {
    if (!currentUser) return { ok: false as const, response: new Response('unauthorised', { status: 401 }) };
    if (!roles.includes(currentUser.role)) return { ok: false as const, response: new Response('forbidden', { status: 403 }) };
    return { ok: true as const, user: currentUser };
  };
  return { requireApiRole: vi.fn(base), requireApprovedApiRole: vi.fn(base) };
});
vi.mock('@/server/notifications/mock', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendBookingReceiptEmailAsync: vi.fn(async () => undefined),
}));
// Capture what the contract body says without paying for a real PDF render.
const renderedBodies: string[] = [];
vi.mock('@/server/contracts/contract-pdf', () => ({
  generateContractPdf: vi.fn(async (a: { body: string }) => { renderedBodies.push(a.body); return Buffer.from('%PDF-stub'); }),
}));

import { db } from '@/server/db/store';
import { findContractClient } from '@/server/contracts/client';
import { renderTemplate, resolveContractVariables } from '@/server/contracts/variables';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-01T00:00:00.000Z';
const A = 'inc-a';
const B = 'inc-b';
const START = '2030-06-10T09:00:00.000Z';
const END = '2030-06-12T17:00:00.000Z';

const client = (id: string, over: Record<string, unknown> = {}) => ({
  id, incubatorId: A, fullName: 'Karim Benali', email: 'karim@example.dz', phone: '+213 555 12 34 56',
  idCardNumber: '109876543210', companyName: null, notes: null, address: '5 Rue Larbi Ben M\'hidi, Oran',
  createdAt: NOW, updatedAt: NOW, ...over,
}) as never;

const TEMPLATE = 'Locataire : {{client_name}}, CNI {{client_id_number}}, demeurant {{client_address}}. Ref {{client_adresse}}.';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.bookings = []; d.deskBookings = []; d.clients = []; d.registrations = [];
    d.incubators = [
      { id: A, name: 'Inc A', city: 'Oran', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz', address: '1 Rue A', createdAt: NOW, updatedAt: NOW } as never,
      { id: B, name: 'Inc B', city: 'Alger', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.spaces = [{
      id: SPACE_ID, incubatorId: A, incubatorName: 'Inc A', name: 'Open space', category: 'TRAINING_ROOM', city: 'Oran',
      capacity: 5, pricePerDay: 3000, isActive: true, workingDays: [0, 1, 2, 3, 4, 5, 6], openingTime: '00:00',
      closingTime: '23:59', unavailableDates: [], blackouts: [], durationDiscounts: [], createdAt: NOW, updatedAt: NOW,
    } as never];
    d.contractTemplates = [{
      id: 'tpl-a', incubatorId: A, name: 'Bail', language: 'fr', spaceCategory: 'ANY', body: TEMPLATE, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.clients = [
      client('cl-karim'),
      client('cl-other-inc', { incubatorId: B, fullName: 'Foreign Person', email: 'foreign@example.dz', idCardNumber: 'FOREIGN-ID', address: 'Foreign address' }),
    ];
  });
  currentUser = hostA;
  renderedBodies.length = 0;
}
beforeEach(seed);

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'bk-1', userId: null, source: 'offline', itemKind: 'SPACE', itemId: SPACE_ID, itemName: 'Open space', vendorName: 'Inc A',
  city: 'Oran', unit: 'DAY', quantity: 2, startsAt: START, endsAt: END, totalAmount: 6000, status: 'CONFIRMED',
  clientReference: 'r', transactionId: null, paymentMethod: 'manual', clientName: 'Karim Benali', clientEmail: null,
  createdAt: NOW, updatedAt: NOW, ...over,
}) as never;

/* ═════════════ 1. Which client is this booking about? ═════════════ */

describe('findContractClient', () => {
  const clients = () => (async () => (await db.read()).clients)();

  it('uses the explicit link, and says it is explicit', async () => {
    const m = findContractClient(await clients(), A, booking({ clientId: 'cl-karim' }), null);
    expect(m).toMatchObject({ linked: true, client: { id: 'cl-karim' } });
  });

  it('never honours a link into ANOTHER incubator\'s book', async () => {
    const m = findContractClient(await clients(), A, booking({ clientId: 'cl-other-inc', clientName: 'Nobody', clientEmail: 'nobody@x.dz' }), null);
    expect(m).toBeNull();
  });

  it('never matches a consultant\'s client, even with the same email', async () => {
    const list = [...(await clients()), client('cl-mentor', { mentorId: 'm1', incubatorId: undefined, email: 'zed@example.dz', fullName: 'Zed' })];
    expect(findContractClient(list as never, A, booking({ clientName: 'Zed', clientEmail: 'zed@example.dz' }), null)).toBeNull();
  });

  it('ignores a record that names a consultant even if it also names this incubator', async () => {
    // Defence in depth: the two books must never mix, so a record carrying BOTH owners is not ours.
    const list = [...(await clients()), client('cl-both', { mentorId: 'm1', fullName: 'Both Owners', email: 'both@example.dz' })];
    expect(findContractClient(list as never, A, booking({ clientName: 'Both Owners', clientEmail: 'both@example.dz' }), null)).toBeNull();
    expect(findContractClient(list as never, A, booking({ clientId: 'cl-both', clientName: 'Nobody Known' }), null)).toBeNull();
  });

  it('falls through to matching when the linked client was deleted', async () => {
    const m = findContractClient(await clients(), A, booking({ clientId: 'gone', clientEmail: 'KARIM@example.dz' }), null);
    expect(m).toMatchObject({ linked: false, client: { id: 'cl-karim' } });
  });

  it('matches an unlinked (older) booking by email, case-insensitively', async () => {
    const m = findContractClient(await clients(), A, booking({ clientEmail: ' Karim@Example.dz ' }), null);
    expect(m?.client.id).toBe('cl-karim');
  });

  it('refuses an ambiguous email rather than guessing between two people', async () => {
    const list = [...(await clients()), client('cl-twin', { fullName: 'Karim Twin', idCardNumber: 'TWIN-ID' })];
    expect(findContractClient(list as never, A, booking({ clientName: 'Someone', clientEmail: 'karim@example.dz' }), null)).toBeNull();
  });

  it('matches by phone across +213 / 0 / spacing variants', async () => {
    for (const phone of ['0555123456', '+213555123456', '0555 12 34 56']) {
      const m = findContractClient(await clients(), A, booking({ clientName: 'X', clientPhone: phone }), null);
      expect(m?.client.id, phone).toBe('cl-karim');
    }
  });

  it('does not match on a short or different phone', async () => {
    expect(findContractClient(await clients(), A, booking({ clientName: 'X', clientPhone: '123' }), null)).toBeNull();
    expect(findContractClient(await clients(), A, booking({ clientName: 'X', clientPhone: '0555999999' }), null)).toBeNull();
  });

  it('trusts a bare name ONLY when the booking has no email or phone to tell people apart', async () => {
    expect(findContractClient(await clients(), A, booking({ clientName: '  karim   BENALI ' }), null)?.client.id).toBe('cl-karim');
    // The booking carries an email that matches nobody: same name is NOT enough.
    expect(findContractClient(await clients(), A, booking({ clientName: 'Karim Benali', clientEmail: 'other@example.dz' }), null)).toBeNull();
  });

  it('refuses a name shared by two clients', async () => {
    const list = [...(await clients()), client('cl-karim-2', { email: 'k2@example.dz', phone: '+213 700 00 00 00', idCardNumber: 'OTHER' })];
    expect(findContractClient(list as never, A, booking({ clientName: 'Karim Benali' }), null)).toBeNull();
  });

  it('a platform user\'s account email can match their client-book entry', async () => {
    const m = findContractClient(await clients(), A, booking({ clientName: 'K', userId: 'u1' }), { email: 'karim@example.dz', phone: '', fullName: 'K' } as never);
    expect(m?.client.id).toBe('cl-karim');
  });
});

/* ═════════════ 2. What the contract says ═════════════ */

describe('resolveContractVariables — ID number and address', () => {
  const resolve = async (b: Record<string, unknown>, match: Parameters<typeof resolveContractVariables>[0]['client']) => {
    const d = await db.read();
    return resolveContractVariables({
      booking: booking(b), space: d.spaces[0]!, incubator: d.incubators[0]!, user: null, lang: 'fr', contractNumber: 'CT-1', client: match,
    });
  };
  const karim = async () => (await db.read()).clients.find((c) => c.id === 'cl-karim')!;

  it('reads both from the linked client', async () => {
    const v = await resolve({ clientId: 'cl-karim' }, { client: await karim(), linked: true });
    expect(v.client_id_number).toBe('109876543210');
    expect(v.client_address).toBe('5 Rue Larbi Ben M\'hidi, Oran');
  });

  it('a linked client is the source of truth: a correction in the client book reaches the next contract', async () => {
    const c = { ...(await karim()), idCardNumber: 'CORRECTED-ID' };
    const v = await resolve({ clientId: 'cl-karim', clientIdNumber: 'OLD-TYPO' }, { client: c, linked: true });
    expect(v.client_id_number).toBe('CORRECTED-ID');
  });

  it('falls back to the booking\'s own snapshot when the linked client has no ID', async () => {
    const c = { ...(await karim()), idCardNumber: null };
    expect((await resolve({ clientId: 'cl-karim', clientIdNumber: 'SNAPSHOT' }, { client: c, linked: true })).client_id_number).toBe('SNAPSHOT');
  });

  it('a GUESSED match never overrides an ID typed on the booking itself', async () => {
    const v = await resolve({ clientIdNumber: 'TYPED-ON-BOOKING' }, { client: await karim(), linked: false });
    expect(v.client_id_number).toBe('TYPED-ON-BOOKING');
  });

  it('a guessed match fills what the booking lacks', async () => {
    const v = await resolve({}, { client: await karim(), linked: false });
    expect(v.client_id_number).toBe('109876543210');
    expect(v.client_address).toBe('5 Rue Larbi Ben M\'hidi, Oran');
  });

  it('with no client at all, both are blank — never undefined, never another person\'s', async () => {
    const v = await resolve({}, null);
    expect(v.client_id_number).toBe('');
    expect(v.client_address).toBe('');
  });

  it('{{client_address}} is a real token now; an unknown look-alike still renders blank', async () => {
    const v = await resolve({ clientId: 'cl-karim' }, { client: await karim(), linked: true });
    const out = renderTemplate(TEMPLATE, v);
    expect(out).toContain('CNI 109876543210');
    expect(out).toContain('demeurant 5 Rue Larbi Ben M\'hidi, Oran');
    expect(out).toContain('Ref .');
  });
});

/* ═════════════ 3. The whole path: book → contract ═════════════ */

const listRoute = async () => import('@/app/api/incubator/bookings/route');
const idRoute = async () => import('@/app/api/incubator/bookings/[id]/route');
const contractRoute = async () => import('@/app/api/incubator/bookings/[id]/contract/route');

const postBooking = async (extra: Record<string, unknown>) =>
  (await listRoute()).POST(new NextRequest('http://localhost/api/incubator/bookings', {
    method: 'POST',
    body: JSON.stringify({
      spaceId: SPACE_ID, clientName: 'Karim Benali', startsAt: START, endsAt: END, unit: 'DAY', totalAmount: 6000,
      paymentMethod: 'CASH', ...extra,
    }),
  }));
const downloadContract = async (id: string) =>
  (await contractRoute()).GET(
    new NextRequest(`http://localhost/api/incubator/bookings/${id}/contract?templateId=tpl-a`),
    { params: Promise.resolve({ id }) },
  );

describe('booking with a picked client, then the contract (the reported flow)', () => {
  it('stores the link plus the client\'s phone and ID, and the contract prints ID and address', async () => {
    const res = await postBooking({ clientId: 'cl-karim' });
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toMatchObject({ clientId: 'cl-karim', clientPhone: '+213 555 12 34 56', clientIdNumber: '109876543210' });

    const pdf = await downloadContract(saved.id);
    expect(pdf.status).toBe(200);
    expect(renderedBodies[0]).toContain('CNI 109876543210');
    expect(renderedBodies[0]).toContain('demeurant 5 Rue Larbi Ben M\'hidi, Oran');
  });

  it('a later correction in the client book is what the NEXT contract prints', async () => {
    const saved = await (await postBooking({ clientId: 'cl-karim' })).json();
    await db.update((d) => { const c = d.clients.find((x) => x.id === 'cl-karim')!; c.idCardNumber = 'FIXED-ID'; c.address = 'New address, Alger'; });
    await downloadContract(saved.id);
    expect(renderedBodies[0]).toContain('CNI FIXED-ID');
    expect(renderedBodies[0]).toContain('New address, Alger');
  });

  it('a booking made BEFORE the link existed (name + email only) still gets them, via the email match', async () => {
    await db.update((d) => { d.bookings = [booking({ id: 'bk-old', clientEmail: 'karim@example.dz' })]; });
    await downloadContract('bk-old');
    expect(renderedBodies[0]).toContain('CNI 109876543210');
    expect(renderedBodies[0]).toContain('demeurant 5 Rue Larbi');
  });

  it('a typed name that matches nobody leaves the fields blank — it does not invent them', async () => {
    const saved = await (await postBooking({ clientName: 'Walk-in Stranger' })).json();
    await downloadContract(saved.id);
    expect(renderedBodies[0]).toContain('CNI ,');
    expect(renderedBodies[0]).toContain('demeurant .');
  });
});

describe('the link is checked, not trusted', () => {
  it('another incubator\'s client id is refused, and nothing is saved', async () => {
    const res = await postBooking({ clientId: 'cl-other-inc' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('CLIENT_NOT_FOUND');
    expect((await db.read()).bookings).toHaveLength(0);
    expect((await db.read()).deskBookings).toHaveLength(0);
  });

  it('an unknown id is refused the same way', async () => {
    const a = await postBooking({ clientId: 'cl-other-inc' });
    const b = await postBooking({ clientId: 'does-not-exist' });
    expect(await a.json()).toEqual(await b.json());
  });

  it('booking without picking anyone still works', async () => {
    const res = await postBooking({});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ clientId: null, clientIdNumber: null });
  });

  it('the contract route will not render another incubator\'s booking', async () => {
    const saved = await (await postBooking({ clientId: 'cl-karim' })).json();
    currentUser = hostB;
    const res = await downloadContract(saved.id);
    expect([403, 404]).toContain(res.status);
    expect(renderedBodies).toHaveLength(0);
  });
});

describe('renaming a booking to someone else does not keep the old person\'s ID', () => {
  const put = async (id: string, over: Record<string, unknown>) =>
    (await idRoute()).PUT(new NextRequest(`http://localhost/api/incubator/bookings/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ startsAt: START, endsAt: END, unit: 'DAY', totalAmount: 6000, clientName: 'Karim Benali', clientEmail: null, ...over }),
    }), { params: Promise.resolve({ id }) });

  it('a different name drops the link, the ID and the phone', async () => {
    const saved = await (await postBooking({ clientId: 'cl-karim' })).json();
    expect((await put(saved.id, { clientName: 'Someone Else Entirely' })).status).toBe(200);
    const b = (await db.read()).bookings.find((x) => x.id === saved.id)!;
    expect(b).toMatchObject({ clientId: null, clientIdNumber: null, clientPhone: null });
    await downloadContract(saved.id);
    expect(renderedBodies[0]).not.toContain('109876543210');
  });

  it('the same name with different case or spacing keeps everything', async () => {
    const saved = await (await postBooking({ clientId: 'cl-karim' })).json();
    expect((await put(saved.id, { clientName: '  KARIM   benali ', notes: 'moved a desk' })).status).toBe(200);
    expect((await db.read()).bookings.find((x) => x.id === saved.id)).toMatchObject({ clientId: 'cl-karim', clientIdNumber: '109876543210' });
  });
});
