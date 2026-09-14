/**
 * The consultant program routes answer the same contract as the incubator's.
 *
 * Two of these pin bugs that shipped silently for months:
 *
 *   • PATCH accepted no pricing fields at all. `price`, `onlinePrice`,
 *     `cashPrice`, `acceptedPaymentMethods` and the deposit were simply absent
 *     from its Zod schema, and Zod strips unknown keys — so a consultant who
 *     edited a price got HTTP 200, a refreshed list, and no change. Nothing
 *     looked broken, which is why nobody found it.
 *
 *   • GET returned an unpaged `{ registrations, total }` with no field
 *     definitions and no filters, so the shared registrants table — the one the
 *     incubator dashboard uses — could not read it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const MENTOR = 'mentor-routes-test';

vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: MENTOR })),
  CONSULTANT_COOKIE_NAME: 'metwork_consultant',
}));

import { db } from '@/server/db/store';
import { PATCH as patchProgram } from '@/app/api/consultant/programs/[id]/route';
import { GET as listRegistrants } from '@/app/api/consultant/registrations/route';

const PROG = 'prog-consultant-routes';
const NOW = '2026-01-01T00:00:00.000Z';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.bookings = []; d.registrations = []; d.clients = []; d.registrationFormFields = [];
    d.incubators = [];
    d.mentors = [
      { id: MENTOR, fullName: 'QA Consultant', email: 'm@example.dz', phone: '+213700000000',
        status: 'APPROVED', approvalStatus: 'APPROVED', isApproved: true, source: 'ADMIN',
        createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.programs = [
      {
        id: PROG, incubatorId: null, incubatorName: null, mentorId: MENTOR, mentorName: 'QA Consultant',
        title: 'Atelier', description: 'x', type: 'TRAINING', city: 'Alger',
        imageUrl: null, imageUrls: [], price: 18_000, onlinePrice: 18_000, cashPrice: 20_000,
        seatsTotal: 12, seatsTaken: 0,
        deadline: '2030-01-01T12:00:00.000Z',
        startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-03T12:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'],
        cashDepositType: 'PERCENT', cashDepositValue: 10,
        isActive: true, slug: 'atelier', createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
  });
}

function patch(body: unknown) {
  return patchProgram(
    new NextRequest(`http://localhost/api/consultant/programs/${PROG}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: PROG }) },
  );
}

const program = async () => (await db.read()).programs.find((p) => p.id === PROG)!;

beforeEach(async () => { await seed(); });

describe('PATCH /api/consultant/programs/[id]', () => {
  it('applies a price change — the edit that used to return 200 and do nothing', async () => {
    const res = await patch({ price: 17_500, onlinePrice: 17_500, cashPrice: 21_500 });
    expect(res.status).toBe(200);

    const p = await program();
    expect(p.price).toBe(17_500);
    expect(p.onlinePrice).toBe(17_500);
    expect(p.cashPrice).toBe(21_500);
  });

  it('applies a payment-method and deposit change', async () => {
    const res = await patch({
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'FIXED',
      cashDepositValue: 4_000,
    });
    expect(res.status).toBe(200);

    const p = await program();
    expect(p.cashDepositType).toBe('FIXED');
    expect(p.cashDepositValue).toBe(4_000);
  });

  it('clears the deposit when cash is switched off', async () => {
    await patch({ acceptedPaymentMethods: ['ONLINE'] });
    const p = await program();
    expect(p.acceptedPaymentMethods).toEqual(['ONLINE']);
    expect(p.cashDepositType ?? null).toBeNull();
    expect(p.cashDepositValue ?? null).toBeNull();
  });

  it('refuses a nonsensical deposit instead of storing it', async () => {
    const res = await patch({ cashDepositType: 'PERCENT', cashDepositValue: 150 });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('INVALID_DEPOSIT');
    // …and the program is untouched.
    expect((await program()).cashDepositValue).toBe(10);
  });

  it('still rejects an inverted date range', async () => {
    const res = await patch({
      startDate: '2030-03-01T12:00:00.000Z',
      endDate: '2030-02-01T12:00:00.000Z',
    });
    // 422 — the schema's own `.refine`, surfaced through `fromZod`.
    expect(res.status).toBe(422);
    expect((await program()).startDate).toBe('2030-02-01T12:00:00.000Z');
  });

  it('refuses to touch a program owned by someone else', async () => {
    await db.update((d) => { d.programs[0]!.mentorId = 'a-different-consultant'; });
    const res = await patch({ price: 1 });
    expect(res.status).toBe(403);
    expect((await program()).price).toBe(18_000);
  });
});

describe('GET /api/consultant/registrations', () => {
  it('answers the envelope the shared registrants table reads', async () => {
    await db.update((d) => {
      d.registrationFormFields = [
        { id: 'f1', entityType: 'PROGRAM', entityId: PROG, incubatorId: null, mentorId: MENTOR,
          label: 'Ville', type: 'SHORT_TEXT', required: true, options: null, order: 1,
          createdAt: NOW, updatedAt: NOW } as never,
      ];
      d.registrations = [
        { id: 'r1', entityType: 'PROGRAM', entityId: PROG, incubatorId: null, mentorId: MENTOR,
          userId: null, fullName: 'Amina', email: 'amina@example.dz', phone: '+213700112233',
          answers: [], status: 'CONFIRMED', clientId: null, bookingId: null,
          createdAt: NOW, updatedAt: NOW } as never,
      ];
    });

    const res = await listRegistrants(
      new NextRequest(`http://localhost/api/consultant/registrations?entityType=PROGRAM&entityId=${PROG}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // The table needs all of these; the old shape had none of them.
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('formFields');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('pageSize');
    expect(body).toHaveProperty('hasMore');
    expect(body.items).toHaveLength(1);
    expect(body.formFields).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('filters by status and search, like the incubator surface', async () => {
    await db.update((d) => {
      d.registrations = [
        { id: 'r1', entityType: 'PROGRAM', entityId: PROG, incubatorId: null, mentorId: MENTOR,
          userId: null, fullName: 'Amina', email: 'amina@example.dz', phone: '+213700112233',
          answers: [], status: 'CONFIRMED', clientId: null, bookingId: null,
          createdAt: NOW, updatedAt: NOW } as never,
        { id: 'r2', entityType: 'PROGRAM', entityId: PROG, incubatorId: null, mentorId: MENTOR,
          userId: null, fullName: 'Karim', email: 'karim@example.dz', phone: '+213700445566',
          answers: [], status: 'CANCELLED', clientId: null, bookingId: null,
          createdAt: NOW, updatedAt: NOW } as never,
      ];
    });

    const q = async (search: string) => {
      const res = await listRegistrants(
        new NextRequest(`http://localhost/api/consultant/registrations?entityType=PROGRAM&entityId=${PROG}&${search}`),
      );
      return (await res.json()).items as Array<{ fullName: string }>;
    };

    expect(await q('status=CONFIRMED')).toHaveLength(1);
    expect((await q('status=CONFIRMED'))[0]!.fullName).toBe('Amina');
    expect(await q('q=karim')).toHaveLength(1);
    expect(await q('q=nobody')).toHaveLength(0);
  });
});
