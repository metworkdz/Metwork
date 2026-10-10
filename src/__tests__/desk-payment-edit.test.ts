/**
 * Correcting the price and the amount paid of a desk participant — from the
 * program's participants dialog or from Réservations — writes ONE set of
 * amounts that both pages, the paid badge and the finance report read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: { id: 'mgr', email: 'i@x.dz', role: 'INCUBATOR' } }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
vi.mock('@/server/incubator/service', () => ({
  findIncubatorByUserEmail: vi.fn(async () => ({ id: 'inc-pay' })),
}));
const { updatedEmail } = vi.hoisted(() => ({ updatedEmail: vi.fn(async () => undefined) }));
vi.mock('@/server/notifications/mock', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendBookingUpdatedEmail: updatedEmail,
}));

import { db, type BookingRecord } from '@/server/db/store';
import { incubatorScope } from '@/server/registrations/service';
import { addOfflineRegistration } from '@/server/registrations/offline-registration';
import { bookingMoney } from '@/server/program-finance/report';
import { deskPaymentOf } from '@/server/bookings/desk-payment';

const INC = 'inc-pay';
const PROG = '5eed0000-0000-4000-8000-000000000101';
const NOW = '2026-09-01T00:00:00.000Z';
const owner = incubatorScope(INC);

beforeEach(async () => {
  updatedEmail.mockClear();
  await db.update((d) => {
    d.users = []; d.clients = []; d.events = []; d.mentors = []; d.deskBookings = []; d.spaces = [];
    d.registrationFormFields = [];
    d.incubators = [{ id: INC, name: 'Hub', status: 'ACTIVE', managerId: 'mgr', email: 'i@x.dz' } as never];
    d.programs = [{
      id: PROG, incubatorId: INC, incubatorName: 'Hub', mentorId: null, title: 'Formation', description: 'x',
      type: 'TRAINING', city: 'Oran', imageUrl: null, price: 6000, seatsTotal: 10,
      deadline: '2030-01-01T12:00:00.000Z', startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-02T12:00:00.000Z',
      acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'formation', createdAt: NOW, updatedAt: NOW,
    } as never];
    d.registrations = []; d.bookings = []; d.wallets = []; d.transactions = [];
  });
});

async function addAtDesk(email: string, depositPaid: number) {
  const r = await addOfflineRegistration({
    entityType: 'PROGRAM', entityId: PROG, owner, actorId: 'mgr',
    fullName: email, email, phone: '0555000000', answers: [], depositPaid,
  });
  if (!r.ok) throw new Error('expected ok');
  return r.registration;
}

const bookingOf = async (id: string) => (await db.read()).bookings.find((b) => b.id === id)!;

async function editRegistration(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/incubator/registrations/edit/route');
  return POST(new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

async function editBooking(id: string, patch: Record<string, unknown>) {
  const b = await bookingOf(id);
  const { PUT } = await import('@/app/api/incubator/bookings/[id]/route');
  return PUT(new NextRequest('http://localhost/x', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startsAt: b.startsAt, endsAt: b.endsAt, unit: b.unit ?? 'DAY', totalAmount: b.totalAmount,
      clientName: b.clientName, clientEmail: b.clientEmail, notes: null, ...patch,
    }),
  }), { params: Promise.resolve({ id }) });
}

async function listed() {
  const { GET } = await import('@/app/api/incubator/registrations/route');
  const res = await GET(new NextRequest(`http://localhost/x?entityType=PROGRAM&entityId=${PROG}`));
  return (await res.json()).items as Array<{ id: string; payment: { total: number; paid: number; editable: boolean } | null }>;
}

describe('from the participants dialog', () => {
  it('records a new amount paid on the booking — balance, badge and finance follow', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    const res = await editRegistration({ id: reg.id, paidAmount: 5000 });
    expect(res.status).toBe(200);
    expect((await res.json()).registration.payment).toEqual({ total: 6000, paid: 5000, editable: true });

    const b = await bookingOf(reg.bookingId!);
    expect(b).toMatchObject({
      totalAmount: 6000, cashDepositPaidAmount: 5000, cashRemainingAmount: 1000,
      paymentStatus: 'AWAITING_CASH', paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 0,
    });
    expect(bookingMoney(b)).toMatchObject({ billed: 6000, cash: 5000, outstanding: 1000 });
    expect(b.paymentEdits).toEqual([
      expect.objectContaining({ by: 'mgr', from: { total: 6000, paid: 2000 }, to: { total: 6000, paid: 5000 } }),
    ]);
    // No money moved through the platform.
    expect((await db.read()).transactions).toHaveLength(0);
  });

  it('paid in full marks the cash collected; lowering it again reopens the balance', async () => {
    const reg = await addAtDesk('a@x.dz', 0);
    await editRegistration({ id: reg.id, paidAmount: 6000 });
    let b = await bookingOf(reg.bookingId!);
    expect(b).toMatchObject({ paymentStatus: 'PAID', cashRemainingAmount: 0, cashCollectedBy: 'mgr' });
    expect(b.cashCollectedAt).toBeTruthy();

    await editRegistration({ id: reg.id, paidAmount: 1000 });
    b = await bookingOf(reg.bookingId!);
    expect(b).toMatchObject({ paymentStatus: 'AWAITING_CASH', cashRemainingAmount: 5000, cashCollectedAt: null });
  });

  it('can change the price itself (a discount)', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    await editRegistration({ id: reg.id, totalAmount: 4000 });
    expect(deskPaymentOf(await bookingOf(reg.bookingId!))).toEqual({ total: 4000, paid: 2000, editable: true });
    expect((await bookingOf(reg.bookingId!)).cashRemainingAmount).toBe(2000);
  });

  it('refuses more paid than the price, and writes nothing — not even the name in the same request', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    const res = await editRegistration({ id: reg.id, fullName: 'Changed', paidAmount: 7000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PAID_EXCEEDS_TOTAL');
    const d = await db.read();
    expect(d.registrations[0]!.fullName).toBe('a@x.dz');
    expect(d.bookings[0]).toMatchObject({ cashDepositPaidAmount: 2000, cashRemainingAmount: 4000 });
  });

  it('rejects a negative or fractional amount at the door', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    expect((await editRegistration({ id: reg.id, paidAmount: -1 })).status).toBe(422);
    expect((await editRegistration({ id: reg.id, paidAmount: 10.5 })).status).toBe(422);
  });

  it('never touches an online payment', async () => {
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-card', itemKind: 'PROGRAM', itemId: PROG, status: 'CONFIRMED', paymentMethod: 'card',
        paymentMode: 'ONLINE_FULL', onlinePaidAmount: 6000, totalAmount: 6000, userId: null,
        clientEmail: 'card@x.dz', paymentStatus: 'PAID', createdAt: NOW, updatedAt: NOW,
      } as never);
      d.registrations.push({
        id: '5eed0000-0000-4000-8000-0000000000d1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC,
        mentorId: null, userId: null, fullName: 'Card', email: 'card@x.dz', phone: '0', answers: [],
        status: 'CONFIRMED', clientId: null, bookingId: 'bk-card', createdAt: NOW, updatedAt: NOW,
      } as never);
    });
    const res = await editRegistration({ id: '5eed0000-0000-4000-8000-0000000000d1', paidAmount: 0 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PAYMENT_NOT_EDITABLE');
    expect((await bookingOf('bk-card'))).toMatchObject({ onlinePaidAmount: 6000, totalAmount: 6000 });
    expect((await listed()).find((r) => r.id === '5eed0000-0000-4000-8000-0000000000d1')!.payment)
      .toEqual({ total: 6000, paid: 6000, editable: false });
  });

  it('a registration without a booking has no amount to edit', async () => {
    await db.update((d) => {
      d.registrations.push({
        id: 'reg-free', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null, userId: null,
        fullName: 'Free', email: 'free@x.dz', phone: '0', answers: [], status: 'CONFIRMED', clientId: null,
        bookingId: null, createdAt: NOW, updatedAt: NOW,
      } as never);
    });
    const res = await editRegistration({ id: 'reg-free', paidAmount: 100 });
    expect((await res.json()).error.code).toBe('NO_BOOKING');
  });

  it('another host’s participant is not found', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    await db.update((d) => { d.registrations[0]!.incubatorId = 'someone-else'; });
    expect((await editRegistration({ id: reg.id, paidAmount: 6000 })).status).toBe(404);
    expect((await bookingOf(reg.bookingId!)).cashDepositPaidAmount).toBe(2000);
  });
});

describe('from Réservations', () => {
  it('the new amount paid shows on the participants list', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    const res = await editBooking(reg.bookingId!, { paidAmount: 6000 });
    expect(res.status).toBe(200);
    expect((await listed()).find((r) => r.id === reg.id)!.payment).toEqual({ total: 6000, paid: 6000, editable: true });
    expect(await bookingOf(reg.bookingId!)).toMatchObject({ paymentStatus: 'PAID', cashRemainingAmount: 0 });
  });

  it('a new price keeps the balance right — it used to leave the old balance due', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    await editBooking(reg.bookingId!, { totalAmount: 5000 });
    expect(await bookingOf(reg.bookingId!)).toMatchObject({
      totalAmount: 5000, cashDepositPaidAmount: 2000, cashRemainingAmount: 3000,
    });
  });

  it('the name and the email move to the participant too', async () => {
    const reg = await addAtDesk('a@x.dz', 2000);
    await editBooking(reg.bookingId!, { clientName: 'Amina B', clientEmail: 'Amina@x.dz' });
    const r = (await db.read()).registrations.find((x) => x.id === reg.id)!;
    expect(r).toMatchObject({ fullName: 'Amina B', email: 'amina@x.dz' });
  });

  it('refuses an email another participant already uses, and writes nothing', async () => {
    const a = await addAtDesk('a@x.dz', 2000);
    await addAtDesk('b@x.dz', 0);
    const res = await editBooking(a.bookingId!, { clientEmail: 'b@x.dz', paidAmount: 6000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('EMAIL_TAKEN');
    expect((await bookingOf(a.bookingId!))).toMatchObject({ clientEmail: 'a@x.dz', cashDepositPaidAmount: 2000 });
  });

  it('refuses more paid than the price', async () => {
    const reg = await addAtDesk('a@x.dz', 0);
    const res = await editBooking(reg.bookingId!, { paidAmount: 9000 });
    expect((await res.json()).error.code).toBe('PAID_EXCEEDS_TOTAL');
  });

  it('a plain manual booking stays paid in full when its price changes', async () => {
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-plain', itemKind: 'PROGRAM', itemId: PROG, status: 'CONFIRMED', paymentMethod: 'manual',
        source: 'offline', totalAmount: 6000, userId: null, clientName: 'P', clientEmail: null, unit: 'DAY',
        startsAt: NOW, endsAt: '2026-09-02T00:00:00.000Z', createdAt: NOW, updatedAt: NOW,
      } as BookingRecord);
    });
    await editBooking('bk-plain', { totalAmount: 5000 });
    const b = await bookingOf('bk-plain');
    expect(b.totalAmount).toBe(5000);
    expect(b.paymentMode).toBeUndefined();
    expect(deskPaymentOf(b)).toEqual({ total: 5000, paid: 5000, editable: true });

    // …and becomes a desk deposit once something is still owed.
    await editBooking('bk-plain', { paidAmount: 3000 });
    expect(await bookingOf('bk-plain')).toMatchObject({
      paymentMode: 'CASH_DEPOSIT', cashDepositPaidAmount: 3000, cashRemainingAmount: 2000, paymentStatus: 'AWAITING_CASH',
    });
  });

  it('a one-day program (same start and end) can still be edited', async () => {
    const reg = await addAtDesk('a@x.dz', 0);
    await db.update((d) => { d.bookings[0]!.endsAt = d.bookings[0]!.startsAt; });
    expect((await editBooking(reg.bookingId!, { paidAmount: 6000 })).status).toBe(200);
    expect((await bookingOf(reg.bookingId!)).paymentStatus).toBe('PAID');
  });

  it('a space still has to end after it starts', async () => {
    await db.update((d) => {
      d.spaces = [{ id: 'sp-1', incubatorId: INC, name: 'Salle' } as never];
      d.bookings.push({
        id: 'bk-space', itemKind: 'SPACE', itemId: 'sp-1', status: 'CONFIRMED', paymentMethod: 'manual',
        source: 'offline', totalAmount: 1000, userId: null, clientName: 'S', clientEmail: null, unit: 'HOUR',
        startsAt: NOW, endsAt: NOW, createdAt: NOW, updatedAt: NOW,
      } as BookingRecord);
    });
    const res = await editBooking('bk-space', { notes: 'x' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('BAD_RANGE');
  });

  it('an unconfirmed cash reservation: notes alone leave it awaiting payment', async () => {
    const reg = await addAtDesk('a@x.dz', 0);
    await db.update((d) => { d.bookings[0]!.status = 'PENDING_PAYMENT'; });
    expect((await editBooking(reg.bookingId!, { paidAmount: 0, notes: 'appelé' })).status).toBe(200);
    const b = await bookingOf(reg.bookingId!);
    expect(b.notes).toBe('appelé');
    expect(b.status).toBe('PENDING_PAYMENT');
  });

  it('an unconfirmed cash reservation: recording the money confirms it', async () => {
    const reg = await addAtDesk('a@x.dz', 0);
    await db.update((d) => { d.bookings[0]!.status = 'PENDING_PAYMENT'; });
    const res = await editBooking(reg.bookingId!, { paidAmount: 6000 });
    expect(res.status).toBe(200);
    const b = await bookingOf(reg.bookingId!);
    expect(b.status).toBe('CONFIRMED');
    expect(deskPaymentOf(b)).toEqual({ total: 6000, paid: 6000, editable: true });
    expect(bookingMoney(b).cash).toBe(6000);
  });
});

describe('an unpaid cash reservation from the public page', () => {
  async function reserveForCash(email: string) {
    const { createRegistration } = await import('@/server/registrations/service');
    const { registration } = await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null, fullName: email, email, phone: '0555000000',
      answers: [],
      cashReservation: {
        listing: { id: PROG, title: 'Formation', vendorName: 'Hub', city: 'Oran', startsAt: NOW, endsAt: NOW },
        amountDue: 6000,
        clientReference: `cash-${PROG}-${email}`,
      },
    });
    return registration;
  }

  it('is editable, and marking it paid in full confirms it', async () => {
    const reg = await reserveForCash('p@x.dz');
    const before = await bookingOf(reg.bookingId!);
    expect(before.status).toBe('PENDING_PAYMENT');
    expect(deskPaymentOf(before)).toEqual({ total: 6000, paid: 0, editable: true });

    const res = await editRegistration({ id: reg.id, paidAmount: 6000 });
    expect(res.status).toBe(200);
    expect((await res.json()).registration.payment).toEqual({ total: 6000, paid: 6000, editable: true });
    const after = await bookingOf(reg.bookingId!);
    expect(after.status).toBe('CONFIRMED');
    expect(after.paymentStatus).toBe('PAID');
  });

  it('a partial payment confirms it with the balance still due', async () => {
    const reg = await reserveForCash('q@x.dz');
    const res = await editRegistration({ id: reg.id, totalAmount: 5000, paidAmount: 2000 });
    expect(res.status).toBe(200);
    const b = await bookingOf(reg.bookingId!);
    expect(b.status).toBe('CONFIRMED');
    expect(b.paymentStatus).toBe('AWAITING_CASH');
    expect(deskPaymentOf(b)).toEqual({ total: 5000, paid: 2000, editable: true });
  });

  it('« Espèces encaissées » collects it in full and confirms it', async () => {
    const reg = await reserveForCash('r@x.dz');
    const { markCashPaid } = await import('@/server/bookings/mark-cash-paid');
    const r = await markCashPaid({ bookingId: reg.bookingId!, isOwned: () => true, collectedByActorId: 'mgr' });
    expect(r.ok).toBe(true);
    const b = await bookingOf(reg.bookingId!);
    expect(b.status).toBe('CONFIRMED');
    expect(b.paymentStatus).toBe('PAID');
    expect(bookingMoney(b).cash).toBe(6000);
    // Replay moves nothing.
    expect((await markCashPaid({ bookingId: reg.bookingId!, isOwned: () => true, collectedByActorId: 'mgr' })).ok).toBe(true);
  });

  it('cancelling the unpaid booking releases the registration too', async () => {
    const reg = await reserveForCash('s@x.dz');
    const { cancelUnpaidBooking } = await import('@/server/bookings/incubator-cancel');
    const r = await cancelUnpaidBooking({ bookingId: reg.bookingId!, managerId: 'mgr' });
    expect(r.ok).toBe(true);
    const row = (await db.read()).registrations.find((x) => x.id === reg.id)!;
    expect(row.status).toBe('CANCELLED');
  });

  it('cancelling the registration closes the unpaid booking too', async () => {
    const reg = await reserveForCash('t@x.dz');
    const { cancelRegistration } = await import('@/server/registrations/service');
    expect((await cancelRegistration(reg.id, owner)).ok).toBe(true);
    expect((await bookingOf(reg.bookingId!)).status).toBe('CANCELLED');
  });

  it('a SPACE cash hold is not confirmed this way — it must pass the availability gate', async () => {
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-space-hold', itemKind: 'SPACE', itemId: 'sp-1', status: 'PENDING_PAYMENT', paymentMethod: 'manual',
        totalAmount: 1000, userId: null, clientName: 'S', clientEmail: null, unit: 'HOUR',
        startsAt: NOW, endsAt: NOW, createdAt: NOW, updatedAt: NOW,
      } as BookingRecord);
    });
    const b = await bookingOf('bk-space-hold');
    expect(deskPaymentOf(b).editable).toBe(false);
    const { markCashPaid } = await import('@/server/bookings/mark-cash-paid');
    const r = await markCashPaid({ bookingId: 'bk-space-hold', isOwned: () => true, collectedByActorId: 'mgr' });
    expect(r.ok).toBe(false);
    expect((await bookingOf('bk-space-hold')).status).toBe('PENDING_PAYMENT');
  });

  it('a cancelled one stays frozen', async () => {
    const reg = await reserveForCash('u@x.dz');
    await db.update((d) => { d.bookings.find((b) => b.id === reg.bookingId)!.status = 'CANCELLED'; });
    const res = await editRegistration({ id: reg.id, paidAmount: 6000 });
    expect(res.status).toBe(409);
  });
});
