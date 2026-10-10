/**
 * A program / event paid from the Metwork wallet is settled on the spot.
 *
 * Production, 2026-10-07: a client paid 23 000 DZD for a training from her
 * wallet. The booking was written PENDING (escrow, waiting for the incubator to
 * press Confirm — a button the bookings page no longer shows) and no
 * registration row was written. The host saw « en attente de paiement », the
 * participants list was empty while the seat counter said 1, and the money
 * never reached the incubator.
 *
 * These drive the real `db.update` critical section and assert the ledger —
 * not just the booking status — so the two rails (card / wallet) cannot drift.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: { id: 'mgr-1', email: 'i@x.dz', role: 'INCUBATOR' } }));
  return { requireApiRole: guard, requireApprovedApiRole: guard, requireApiSession: guard };
});

import { db } from '@/server/db/store';
import { applyToProgram, registerForEvent } from '@/server/bookings/service';
import { countAttendance } from '@/server/attendance';
import { bookingMoney } from '@/server/program-finance/report';

const NOW = '2026-06-01T10:00:00.000Z';
const PRICE = 23_000;
/** Default receiver commission on a COMMISSION-plan incubator. */
const COMMISSION = Math.round(PRICE * 0.05);

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = [{
      id: 'u-1', email: 'client@x.dz', fullName: 'Client Un', phone: '+213555000000', role: 'ENTREPRENEUR', locale: 'fr',
    } as never];
    d.wallets = [
      { id: 'w-client', userId: 'u-1', balance: 50_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
      { id: 'w-mgr', userId: 'mgr-1', balance: 1_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ];
    d.transactions = [];
    d.bookings = [];
    d.registrations = [];
    d.registrationFormFields = [];
    d.clients = [];
    d.promoCodes = [];
    d.incubators = [{ id: 'inc-1', name: 'Hub', status: 'ACTIVE', managerId: 'mgr-1' } as never];
    d.programs = [{
      id: 'prog-1', incubatorId: 'inc-1', incubatorName: 'Hub', mentorId: null, title: 'Techniques de vente',
      description: 'x', type: 'TRAINING', city: 'Oran', imageUrl: null, imageUrls: [], price: PRICE,
      seatsTotal: 10, seatsTaken: 0, deadline: '2030-01-01T00:00:00.000Z', startDate: '2030-02-01T00:00:00.000Z',
      endDate: '2030-02-02T00:00:00.000Z', acceptedPaymentMethods: ['ONLINE', 'CASH'], slug: 'vente',
      isActive: true, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.events = [{
      id: 'evt-1', incubatorId: 'inc-1', incubatorName: 'Hub', title: 'Meetup', description: 'x', city: 'Oran',
      eventDate: '2030-02-01T00:00:00.000Z', price: PRICE, capacity: 10, acceptedPaymentMethods: ['ONLINE', 'CASH'],
      isActive: true, slug: 'meetup', createdAt: NOW, updatedAt: NOW,
    } as never];
  });
}

const read = () => db.read();

describe('wallet-paid program application', () => {
  beforeEach(seed);

  it('is CONFIRMED and PAID at once, and the incubator is credited net of commission', async () => {
    const r = await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.status).toBe('CONFIRMED');
    expect(r.booking.paymentStatus).toBe('PAID');
    expect(r.booking.settledAt).toBeTruthy();
    expect(r.booking.commissionAmount).toBe(COMMISSION);

    const d = await read();
    expect(d.wallets.find((w) => w.id === 'w-client')!.balance).toBe(50_000 - PRICE);
    expect(d.wallets.find((w) => w.id === 'w-mgr')!.balance).toBe(1_000 + PRICE - COMMISSION);
    const mgrTx = d.transactions.filter((t) => t.userId === 'mgr-1').map((t) => [t.type, t.amount]);
    expect(mgrTx).toEqual([['PAYOUT', PRICE], ['COMMISSION', -COMMISSION]]);

    // The finance report reads it as wallet money, paid whole.
    expect(bookingMoney(r.booking)).toMatchObject({ billed: PRICE, online: PRICE, commission: COMMISSION, channel: 'WALLET' });
  });

  it('writes the participant row, linked to the booking — and it is ONE seat', async () => {
    const r = await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-1' });
    if (!r.ok) throw new Error('expected ok');
    const d = await read();
    const regs = d.registrations.filter((x) => x.entityId === 'prog-1');
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ bookingId: r.booking.id, status: 'CONFIRMED', email: 'client@x.dz', incubatorId: 'inc-1' });
    expect(countAttendance(d, 'PROGRAM', 'prog-1')).toBe(1);
  });

  it('a replay moves no money and writes nothing twice', async () => {
    await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-1' });
    const again = await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-1' });
    expect(again.ok && again.replayed).toBe(true);
    const d = await read();
    expect(d.wallets.find((w) => w.id === 'w-mgr')!.balance).toBe(1_000 + PRICE - COMMISSION);
    expect(d.transactions).toHaveLength(3);
    expect(d.registrations).toHaveLength(1);
    expect(d.bookings).toHaveLength(1);
  });

  it('a Pro (FLAT) incubator is credited the full amount', async () => {
    await db.update((d) => {
      Object.assign(d.incubators[0]!, {
        subscriptionCode: 'FLAT', subscriptionStatus: 'ACTIVE', subscriptionPeriodEnd: '2099-01-01T00:00:00.000Z',
      });
    });
    const r = await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.booking.commissionAmount).toBe(0);
    const d = await read();
    expect(d.wallets.find((w) => w.id === 'w-mgr')!.balance).toBe(1_000 + PRICE);
    expect(d.transactions.some((t) => t.type === 'COMMISSION')).toBe(false);
  });

  it('a cash application writes the participant row and moves no money', async () => {
    const r = await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-c', paymentMethod: 'manual' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.booking.status).toBe('PENDING_PAYMENT');
    const d = await read();
    expect(d.transactions).toHaveLength(0);
    expect(d.registrations.find((x) => x.bookingId === r.booking.id)?.status).toBe('CONFIRMED');
    expect(countAttendance(d, 'PROGRAM', 'prog-1')).toBe(1);
  });
});

describe('wallet-paid event registration', () => {
  beforeEach(seed);

  it('settles the same way as a program', async () => {
    const r = await registerForEvent({ userId: 'u-1', eventId: 'evt-1', clientReference: 'ref-e' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.booking.status).toBe('CONFIRMED');
    const d = await read();
    expect(d.wallets.find((w) => w.id === 'w-mgr')!.balance).toBe(1_000 + PRICE - COMMISSION);
    expect(d.registrations.find((x) => x.bookingId === r.booking.id)?.entityType).toBe('EVENT');
  });
});

describe('cancelling a wallet-paid booking', () => {
  beforeEach(seed);

  it('refunds the client and leaves the incubator exactly where it started', async () => {
    const r = await applyToProgram({ userId: 'u-1', programId: 'prog-1', clientReference: 'ref-1' });
    if (!r.ok) throw new Error('expected ok');
    const { PATCH } = await import('@/app/api/incubator/bookings/[id]/route');
    const res = await PATCH(new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELLED' }),
    }), { params: Promise.resolve({ id: r.booking.id }) });
    expect(res.status).toBe(200);
    const d = await read();
    expect(d.wallets.find((w) => w.id === 'w-client')!.balance).toBe(50_000);
    expect(d.wallets.find((w) => w.id === 'w-mgr')!.balance).toBe(1_000);
    expect(d.registrations.find((x) => x.bookingId === r.booking.id)?.status).toBe('CANCELLED');
    expect(countAttendance(d, 'PROGRAM', 'prog-1')).toBe(0);
  });
});
