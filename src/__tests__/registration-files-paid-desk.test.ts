/**
 * File answers on the two registration paths that do not go through the free
 * public route: the PAID card checkout and the desk ("add a participant").
 *
 *   • Paid: files are verified BEFORE any money moves, and the intent carries
 *     what storage measured — so settlement later writes trustworthy facts.
 *   • Desk: a host cannot upload on someone's behalf. A required file question
 *     must not stop them seating a walk-in, and a file answer smuggled into the
 *     request must not reach the registration unverified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type * as EmailModule from '@/server/notifications/email';
import type * as CardPaymentModule from '@/server/bookings/card-payment';
import { db } from '@/server/db/store';

const assets = new Map<string, Buffer>();
vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => true,
  getAuthenticatedRawResource: async (id: string) => {
    const b = assets.get(id);
    return b ? { bytes: b.length } : null;
  },
  readAuthenticatedRawHead: async (id: string, n: number) => assets.get(id)?.subarray(0, n) ?? null,
  destroyAuthenticatedRaw: async (id: string) => { assets.delete(id); },
}));

vi.mock('@/server/auth/session', () => ({ readSession: vi.fn(async () => null) }));
vi.mock('@/lib/session', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: vi.fn(async () => true) }));
vi.mock('@/server/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  sendResendEmail: async () => true,
}));
const createCardBookingIntent = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  replayed: false,
  booking: { bookingLocale: 'fr' },
  token: 'tok-123',
}));
vi.mock('@/server/bookings/card-payment', async (importOriginal) => ({
  ...(await importOriginal<typeof CardPaymentModule>()),
  createCardBookingIntent: (...args: unknown[]) => createCardBookingIntent(...args),
}));

import { POST as cardRoute } from '@/app/api/bookings/card/route';
import { addOfflineRegistration } from '@/server/registrations/offline-registration';
import { incubatorScope } from '@/server/registrations/service';
import { buildRegistrationFilePublicId } from '@/server/registrations/files';

const INC = 'inc-pd';
const MGR = 'mgr-pd';
const PROG = '99999999-9999-4999-8999-999999999999';
const FILE_FIELD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-01-01T00:00:00.000Z';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024, 7)]);

async function seed(fileRequired: boolean) {
  await db.update((d) => {
    d.users = []; d.wallets = []; d.transactions = [];
    d.bookings = []; d.registrations = []; d.clients = []; d.events = [];
    d.incubators = [{ id: INC, name: 'PD Incubator', status: 'ACTIVE', managerId: MGR, email: 'i@x.dz' } as never];
    d.programs = [{
      id: PROG, incubatorId: INC, incubatorName: 'PD Incubator', mentorId: null,
      title: 'Bootcamp', description: 'x', type: 'TRAINING', city: 'Oran',
      imageUrl: null, imageUrls: [], price: 20_000, onlinePrice: 20_000, cashPrice: 20_000,
      seatsTotal: 10, seatsTaken: 0, deadline: '2030-01-01T00:00:00.000Z',
      startDate: '2030-02-01T11:00:00.000Z', startTime: '09:00', endDate: '2030-02-03T11:00:00.000Z',
      acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'bootcamp',
      createdAt: NOW, updatedAt: NOW,
    } as never];
    d.registrationFormFields = [{
      id: FILE_FIELD, entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
      label: 'Pitch deck', labelKey: null, type: 'FILE', options: null, optionKeys: null,
      required: fileRequired, order: 0, showWhen: null, createdAt: NOW, updatedAt: NOW,
    }] as never;
  });
}

function cardReq(answers: unknown[]) {
  return new NextRequest('http://localhost/api/bookings/card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: { itemKind: 'PROGRAM', programId: PROG },
      paymentMode: 'ONLINE_FULL',
      customer: { fullName: 'Guest User', email: 'guest@x.com', phone: '+213500000000' },
      clientReference: 'ref-12345678',
      registrationAnswers: answers,
    }),
  });
}

beforeEach(() => {
  assets.clear();
  createCardBookingIntent.mockClear();
});

describe('paid checkout with a file', () => {
  it('verifies the file and hands the intent the facts storage measured', async () => {
    await seed(true);
    const id = buildRegistrationFilePublicId('PROGRAM', PROG, FILE_FIELD);
    assets.set(id, PDF);

    const res = await cardRoute(cardReq([{ fieldId: FILE_FIELD, value: id, fileName: 'deck.pdf' }]));
    expect(res.status).toBe(201);
    const arg = createCardBookingIntent.mock.calls[0]![0] as { registrationAnswers: unknown };
    expect(arg.registrationAnswers).toEqual([
      { fieldId: FILE_FIELD, value: id, file: { name: 'deck.pdf', bytes: PDF.length, contentType: 'application/pdf' } },
    ]);
  });

  it('refuses before any money moves when the file is not a PDF/JPG', async () => {
    await seed(true);
    const id = buildRegistrationFilePublicId('PROGRAM', PROG, FILE_FIELD);
    assets.set(id, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512)]));

    const res = await cardRoute(cardReq([{ fieldId: FILE_FIELD, value: id }]));
    expect(res.status).toBe(415);
    expect(createCardBookingIntent).not.toHaveBeenCalled();
  });

  it('still demands a required file', async () => {
    await seed(true);
    const res = await cardRoute(cardReq([]));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('MISSING_REQUIRED_FIELD');
    expect(createCardBookingIntent).not.toHaveBeenCalled();
  });
});

describe('desk participant with file questions', () => {
  const walkin = (answers: Array<{ fieldId: string; value: string }>) => ({
    entityType: 'PROGRAM' as const,
    entityId: PROG,
    owner: incubatorScope(INC),
    actorId: MGR,
    fullName: 'Amina B.',
    email: 'amina@example.dz',
    phone: '+213700112233',
    answers,
    locale: 'fr',
    depositPaid: 0,
  });

  it('seats a walk-in even though a file question is required', async () => {
    await seed(true);
    const res = await addOfflineRegistration(walkin([]));
    expect(res.ok).toBe(true);
  });

  it('drops a file answer, so an unverified id never reaches the registration', async () => {
    await seed(false);
    const res = await addOfflineRegistration(walkin([{
      fieldId: FILE_FIELD,
      value: 'metwork/pitch-decks/pitch-deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    }]));
    expect(res.ok).toBe(true);
    expect((await db.read()).registrations[0]!.answers).toEqual([]);
  });
});
