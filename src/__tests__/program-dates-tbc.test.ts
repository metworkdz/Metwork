/**
 * Programs whose dates are still to confirm — pre-registrations.
 *
 * Until the host sets the dates: registration is open and FREE (no deadline
 * to pass, no payment on any rail), nothing prints a date that does not
 * exist, and nothing that needs one — a paid booking, a certificate — can be
 * made. Setting the dates turns it into an ordinary program.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as EmailModule from '@/server/notifications/email';

let actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: actor }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'mentor-1' })),
}));
vi.mock('@/server/auth/session', () => ({ readSession: vi.fn(async () => null) }));
vi.mock('@/server/notifications/email', async (orig) => ({
  ...(await orig<typeof EmailModule>()),
  sendResendEmail: vi.fn(async () => true),
}));

import { db } from '@/server/db/store';
import {
  programDateSortKey,
  programDates,
  programDatesTbc,
  programDeadlinePassed,
} from '@/lib/program-dates';
import { resolveProgramDates } from '@/server/programs/dates';
import { emptyProgramForm, programFormToPayload, validateProgramForm } from '@/lib/program-form';

const TBC_ID = '11111111-1111-4111-8111-111111111111';
const DATED_ID = '22222222-2222-4222-8222-222222222222';
const MENTOR_TBC_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-01T00:00:00.000Z';

function program(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, incubatorId: 'inc-a', incubatorName: 'Hub A', mentorId: null, title: `P ${id.slice(0, 4)}`,
    description: 'Une description suffisante.', type: 'TRAINING', city: 'Alger', imageUrl: null,
    price: 12_000, seatsTotal: 20, acceptedPaymentMethods: ['ONLINE', 'CASH'],
    deadline: '2030-01-10T12:00:00.000Z', startDate: '2030-01-15T12:00:00.000Z', endDate: '2030-01-16T12:00:00.000Z',
    isActive: true, slug: id, createdAt: NOW, updatedAt: NOW, ...extra,
  } as never;
}
const TBC = { datesTbc: true, deadline: null, startDate: null, endDate: null };

beforeEach(async () => {
  actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
  await db.update((d) => {
    d.users = [];
    d.incubators = [{ id: 'inc-a', name: 'Hub A', managerId: 'mgr-a', email: 'a@x.dz', status: 'ACTIVE', archivedAt: null } as never];
    d.mentors = [{ id: 'mentor-1', fullName: 'Amina', approvalStatus: 'APPROVED', source: 'ADMIN' } as never];
    d.programs = [
      program(TBC_ID, TBC),
      program(DATED_ID),
      program(MENTOR_TBC_ID, { ...TBC, incubatorId: null, incubatorName: '', mentorId: 'mentor-1' }),
    ];
    d.registrations = [];
    d.registrationFormFields = [];
    d.bookings = [];
    d.certificates = [];
  });
});

describe('the rules', () => {
  it('a program with no dates reads as to confirm, flag or not', () => {
    expect(programDatesTbc({ datesTbc: true, startDate: 'x', endDate: 'y', deadline: 'z' })).toBe(true);
    expect(programDatesTbc({ startDate: null, endDate: null, deadline: null })).toBe(true);
    expect(programDates({ ...TBC })).toBeNull();
  });

  it('has no deadline to pass, and sorts after dated programs', () => {
    expect(programDeadlinePassed(TBC)).toBe(false);
    expect(programDeadlinePassed({ deadline: '2000-01-01', startDate: '2000-01-02', endDate: '2000-01-03' })).toBe(true);
    expect(programDateSortKey(TBC, 'deadline')).toBe(Number.POSITIVE_INFINITY);
  });

  it('resolves writes: all three dates in order, or none', () => {
    expect(resolveProgramDates(null, { datesTbc: true, deadline: '2030-01-01T12:00:00Z' }))
      .toEqual({ ok: true, value: { datesTbc: true, deadline: null, startDate: null, endDate: null } });
    expect(resolveProgramDates(null, { deadline: '2030-01-01T12:00:00Z' })).toEqual({ ok: false, reason: 'DATES_REQUIRED' });
    expect(resolveProgramDates(null, {
      deadline: '2030-01-20T12:00:00Z', startDate: '2030-01-15T12:00:00Z', endDate: '2030-01-16T12:00:00Z',
    })).toEqual({ ok: false, reason: 'DATES_ORDER' });
  });

  it('sending dates to a program to confirm fixes them — all three needed', () => {
    const existing = { id: 'p', ...TBC };
    expect(resolveProgramDates(existing, { startDate: '2030-01-15T12:00:00Z' })).toEqual({ ok: false, reason: 'DATES_REQUIRED' });
    const fixed = resolveProgramDates(existing, {
      deadline: '2030-01-10T12:00:00Z', startDate: '2030-01-15T12:00:00Z', endDate: '2030-01-16T12:00:00Z',
    });
    expect(fixed).toMatchObject({ ok: true, value: { datesTbc: false } });
    // Saying nothing keeps it to confirm.
    expect(resolveProgramDates(existing, {})).toMatchObject({ ok: true, value: { datesTbc: true } });
  });

  it('a program with booked seats cannot go back to "to confirm"', () => {
    const existing = { id: 'p', datesTbc: false, deadline: 'a', startDate: 'b', endDate: 'c' };
    const seat = { itemKind: 'PROGRAM' as const, itemId: 'p', status: 'CONFIRMED' as const, deletedAt: null };
    expect(resolveProgramDates(existing, { datesTbc: true }, [seat])).toEqual({ ok: false, reason: 'HAS_BOOKINGS' });
    const cancelled = { ...seat, status: 'CANCELLED' as const };
    expect(resolveProgramDates(existing, { datesTbc: true }, [cancelled])).toMatchObject({ ok: true });
  });

  it('the form skips date checks and sends no dates while to confirm', () => {
    const form = { ...emptyProgramForm(), title: 'Pré-inscription', description: 'Une pré-inscription.', city: 'Alger', datesTbc: true };
    expect(validateProgramForm(form)).toBeNull();
    expect(programFormToPayload(form)).toMatchObject({ datesTbc: true, deadline: null, startDate: null, endDate: null });
    expect(validateProgramForm({ ...form, datesTbc: false })).toBe('dates');
  });
});

const valid = {
  title: 'Pré-inscription juridique', description: 'Pour mesurer la demande.', type: 'TRAINING', city: 'Alger',
  price: 5000, seatsTotal: 30, acceptedPaymentMethods: ['ONLINE'],
};
const json = (method: string, body: unknown) => new NextRequest('http://localhost/x', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('creating and editing', () => {
  it('creates a program to confirm with no dates at all — both populations', async () => {
    const incubator = await import('@/app/api/incubator/programs/route');
    const a = await (await incubator.POST(json('POST', { ...valid, datesTbc: true }))).json();
    expect(a).toMatchObject({ datesTbc: true, deadline: null, startDate: null, endDate: null });
    const consultant = await import('@/app/api/consultant/programs/route');
    const b = await (await consultant.POST(json('POST', { ...valid, datesTbc: true, deadline: '2030-01-01T12:00:00.000Z' }))).json();
    expect(b).toMatchObject({ datesTbc: true, deadline: null });
  });

  it('refuses a dated program with missing or disordered dates', async () => {
    const { POST } = await import('@/app/api/incubator/programs/route');
    expect((await POST(json('POST', valid))).status).toBe(422);
    const res = await POST(json('POST', {
      ...valid, deadline: '2030-01-20T12:00:00.000Z', startDate: '2030-01-15T12:00:00.000Z', endDate: '2030-01-16T12:00:00.000Z',
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('DATES_ORDER');
  });

  it('fixing the dates later turns it into an ordinary program', async () => {
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/route');
    const partial = await PATCH(json('PATCH', { startDate: '2030-02-01T12:00:00.000Z', title: 'Nouveau titre' }), ctx(TBC_ID));
    expect(partial.status).toBe(422);
    // The refused edit wrote nothing, not even the title.
    expect((await db.read()).programs.find((p) => p.id === TBC_ID)!.title).toBe(`P ${TBC_ID.slice(0, 4)}`);

    const ok = await PATCH(json('PATCH', {
      deadline: '2030-01-25T12:00:00.000Z', startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-02T12:00:00.000Z',
    }), ctx(TBC_ID));
    expect(ok.status).toBe(200);
    expect((await ok.json()).program).toMatchObject({ datesTbc: false, startDate: '2030-02-01T12:00:00.000Z' });
  });

  it('refuses to put a program with booked seats back to "to confirm"', async () => {
    await db.update((d) => {
      d.bookings.push({ id: 'bk', itemKind: 'PROGRAM', itemId: DATED_ID, status: 'CONFIRMED', totalAmount: 12_000 } as never);
    });
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/route');
    const res = await PATCH(json('PATCH', { datesTbc: true }), ctx(DATED_ID));
    expect(res.status).toBe(409);
    expect((await db.read()).programs.find((p) => p.id === DATED_ID)!.startDate).toBe('2030-01-15T12:00:00.000Z');
  });
});

describe('signing up', () => {
  const signUp = (entityId: string, extra: Record<string, unknown> = {}) => json('POST', {
    entityType: 'PROGRAM', entityId, fullName: 'Amel Kaci', email: `amel-${entityId.slice(0, 2)}@x.dz`,
    phone: '0555000000', ...extra,
  });

  it('a paid program to confirm takes a free pre-registration — no booking, no money', async () => {
    const { POST } = await import('@/app/api/registrations/route');
    const res = await POST(signUp(TBC_ID));
    expect(res.status).toBe(201);
    const d = await db.read();
    expect(d.registrations).toHaveLength(1);
    expect(d.registrations[0]!.bookingId ?? null).toBeNull();
    expect(d.bookings).toHaveLength(0);
  });

  it('the same paid program with dates still requires payment', async () => {
    const { POST } = await import('@/app/api/registrations/route');
    expect((await POST(signUp(DATED_ID))).status).toBe(422);
  });

  it('no card checkout while the dates are to confirm', async () => {
    const { createCardBookingIntent } = await import('@/server/bookings/card-payment');
    const res = await createCardBookingIntent({
      target: { itemKind: 'PROGRAM', programId: TBC_ID },
      paymentMode: 'ONLINE_FULL',
      customer: { fullName: 'Karim', email: 'karim@x.dz', phone: '+213700112233' },
      clientReference: 'ref-tbc',
      locale: 'fr',
    } as never);
    expect(res).toMatchObject({ ok: false, reason: 'DATES_TBC' });
    expect((await db.read()).bookings).toHaveLength(0);
  });

  it('no wallet application while the dates are to confirm', async () => {
    const { applyToProgram } = await import('@/server/bookings/service');
    const res = await applyToProgram({ userId: 'u-1', programId: TBC_ID, clientReference: 'ref-w' } as never);
    expect(res).toMatchObject({ ok: false, reason: 'DATES_TBC' });
  });

  it('the desk records a pre-registration without charging', async () => {
    const { addOfflineRegistration } = await import('@/server/registrations/offline-registration');
    const res = await addOfflineRegistration({
      entityType: 'PROGRAM', entityId: TBC_ID, owner: { kind: 'INCUBATOR', incubatorId: 'inc-a' }, actorId: 'mgr-a',
      fullName: 'Sara', email: 'sara@x.dz', phone: '0555', answers: [], depositPaid: 3000,
    });
    expect(res).toMatchObject({ ok: true, totalAmount: 0, depositPaid: 0, dueOnSite: 0 });
    expect((await db.read()).bookings).toHaveLength(0);
  });
});

describe('what needs a date waits for one', () => {
  it('certificates cannot be issued until the dates are set', async () => {
    await db.update((d) => {
      const p = d.programs.find((x) => x.id === TBC_ID)!;
      p.certificateSettings = { title: 'ATTESTATION' } as never;
      d.registrations.push({ id: 'r1', entityType: 'PROGRAM', entityId: TBC_ID, status: 'CONFIRMED', fullName: 'Amel', email: 'a@x.dz', incubatorId: 'inc-a', answers: [] } as never);
    });
    const { issueCertificates } = await import('@/server/certificates/issue');
    expect(await issueCertificates(TBC_ID, { kind: 'INCUBATOR', incubatorId: 'inc-a' }))
      .toEqual({ ok: false, reason: 'DATES_TBC' });
  });

  it('the catalogue lists it as open, and the status says so', async () => {
    const { listPrograms } = await import('@/server/bookings/program-catalog');
    const tbc = (await listPrograms()).find((p) => p.id === TBC_ID)!;
    expect(tbc).toMatchObject({ datesTbc: true, deadline: null });
    const { GET } = await import('@/app/api/programs/[id]/status/route');
    const status = await (await GET(new Request('http://localhost/x'), ctx(TBC_ID))).json();
    expect(status).toMatchObject({ datesTbc: true, deadlinePassed: false, deadline: null });
  });

  it('the finance report exports "Dates à confirmer" instead of a date', async () => {
    const { loadProgramFinances } = await import('@/server/program-finance/service');
    const { renderProgramFinancePdf } = await import('@/server/program-finance/export');
    const f = (await loadProgramFinances(TBC_ID, { kind: 'INCUBATOR', incubatorId: 'inc-a' }))!;
    const pdf = await renderProgramFinancePdf(f);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
