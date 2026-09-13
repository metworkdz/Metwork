/**
 * Deleting a program or event takes its application form and its registrations
 * with it — and leaves the financial record alone.
 *
 * Both delete handlers used to splice the listing and stop there, so the form
 * fields and registrations were left pointing at an id that no longer resolved.
 * Nothing reads them (every dashboard query is scoped by entity), so they piled
 * up invisibly: production carried 11 such rows from two deleted programs.
 *
 * The deliberate exception is BOOKINGS. Money that moved has to stay auditable
 * even when the listing is gone, and a receipt already in someone's inbox must
 * still correspond to a record. An orphaned booking is inert — `countAttendance`
 * is always scoped to a live listing — so keeping it costs nothing while losing
 * it would cost the audit trail.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import { pruneListingChildrenSync } from '@/server/registrations/service';

const PROG = 'prog-cascade';
const OTHER_PROG = 'prog-keep';
const EVENT = 'event-cascade';
const NOW = '2026-01-01T00:00:00.000Z';

function field(id: string, entityType: 'PROGRAM' | 'EVENT', entityId: string) {
  return {
    id, entityType, entityId, incubatorId: 'inc-1', mentorId: null,
    label: `Q ${id}`, labelKey: null, type: 'SHORT_TEXT', options: null,
    optionKeys: null, required: false, order: 0, createdAt: NOW, updatedAt: NOW,
  } as never;
}

function registration(id: string, entityType: 'PROGRAM' | 'EVENT', entityId: string) {
  return {
    id, entityType, entityId, incubatorId: 'inc-1', mentorId: null, userId: null,
    fullName: 'Someone', email: `${id}@example.dz`, phone: '+213700000000',
    answers: [], status: 'CONFIRMED', clientId: null, createdAt: NOW, updatedAt: NOW,
  } as never;
}

beforeEach(async () => {
  await db.update((d) => {
    d.programs = [
      { id: PROG, title: 'Going', isActive: true } as never,
      { id: OTHER_PROG, title: 'Staying', isActive: true } as never,
    ];
    d.events = [{ id: EVENT, title: 'Going too', isActive: true } as never];
    d.registrationFormFields = [
      field('f1', 'PROGRAM', PROG),
      field('f2', 'PROGRAM', PROG),
      field('f3', 'PROGRAM', OTHER_PROG),
      field('f4', 'EVENT', EVENT),
      // Same id on the OTHER kind — the prune must not confuse the two.
      field('f5', 'EVENT', PROG),
    ];
    d.registrations = [
      registration('r1', 'PROGRAM', PROG),
      registration('r2', 'PROGRAM', OTHER_PROG),
      registration('r3', 'EVENT', EVENT),
    ];
    d.bookings = [
      {
        id: 'bk-1', userId: null, itemKind: 'PROGRAM', itemId: PROG,
        itemName: 'Going', vendorName: 'v', city: 'Alger', unit: 'DAY', quantity: 1,
        startsAt: NOW, endsAt: NOW, totalAmount: 22_000, status: 'CONFIRMED',
        paymentStatus: 'PAID', clientReference: 'ref-1', transactionId: null,
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
    d.transactions = [];
  });
});

async function prune(entityType: 'PROGRAM' | 'EVENT', entityId: string) {
  return db.update((d) => pruneListingChildrenSync(d, entityType, entityId));
}

describe('pruneListingChildrenSync', () => {
  it('removes the deleted program\'s form and registrations', async () => {
    const removed = await prune('PROGRAM', PROG);
    expect(removed).toEqual({ formFields: 2, registrations: 1 });

    const d = await db.read();
    expect(d.registrationFormFields.map((f) => f.id).sort()).toEqual(['f3', 'f4', 'f5']);
    expect(d.registrations.map((r) => r.id).sort()).toEqual(['r2', 'r3']);
  });

  it('leaves another listing\'s rows completely alone', async () => {
    await prune('PROGRAM', PROG);
    const d = await db.read();
    expect(d.registrationFormFields.find((f) => f.id === 'f3')).toBeTruthy();
    expect(d.registrations.find((r) => r.id === 'r2')).toBeTruthy();
  });

  it('does not cross entity kinds sharing an id', async () => {
    // 'f5' is an EVENT row that happens to carry the program's id.
    await prune('PROGRAM', PROG);
    const d = await db.read();
    expect(d.registrationFormFields.find((f) => f.id === 'f5')).toBeTruthy();
  });

  it('KEEPS the booking — money that moved stays auditable', async () => {
    await prune('PROGRAM', PROG);
    const d = await db.read();
    expect(d.bookings).toHaveLength(1);
    expect(d.bookings[0]!.totalAmount).toBe(22_000);
    expect(d.bookings[0]!.paymentStatus).toBe('PAID');
  });

  it('cascades an event the same way', async () => {
    const removed = await prune('EVENT', EVENT);
    expect(removed).toEqual({ formFields: 1, registrations: 1 });
    const d = await db.read();
    expect(d.registrationFormFields.find((f) => f.id === 'f4')).toBeUndefined();
    expect(d.registrations.find((r) => r.id === 'r3')).toBeUndefined();
  });

  it('is a no-op the second time', async () => {
    await prune('PROGRAM', PROG);
    expect(await prune('PROGRAM', PROG)).toEqual({ formFields: 0, registrations: 0 });
  });

  it('is a no-op for a listing that never had children', async () => {
    expect(await prune('PROGRAM', 'never-existed')).toEqual({ formFields: 0, registrations: 0 });
  });
});
