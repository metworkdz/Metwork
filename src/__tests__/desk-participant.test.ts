/**
 * Adding a participant who signed up AT THE DESK.
 *
 * The office takes cash. Before this path existed, the only way to record it
 * was a manual booking, which moved the seat count but left the person out of
 * the participants list, had nowhere to put "paid 5 000, owes 20 000", and
 * sent them nothing. The host tracked the balance on paper.
 *
 * What these tests hold down, in order of how much it would cost to get wrong:
 *   1. the seat is counted ONCE, not twice, despite two records existing
 *   2. the deposit and the balance are both recorded, and the balance can be
 *      closed later by the same button that closes a card deposit
 *   3. capacity is enforced with the SAME count every other surface reads
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as EmailModule from '@/server/notifications/email';

const sent: Array<{ to: string; subject: string; html: string }> = [];
vi.mock('@/server/notifications/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return {
    ...actual,
    sendResendEmail: async (o: { to: string; subject: string; html: string }) => {
      sent.push(o);
      return true;
    },
  };
});

import { db } from '@/server/db/store';
import { addOfflineRegistration } from '@/server/registrations/offline-registration';
import { incubatorScope } from '@/server/registrations/service';
import { createRegistration } from '@/server/registrations/service';
import { countAttendance } from '@/server/attendance';
import { markCashPaid } from '@/server/bookings/mark-cash-paid';

const INC = 'inc-desk';
const MGR = 'mgr-desk';
const PROG = 'prog-desk';
const NOW = '2026-01-01T00:00:00.000Z';

const TOTAL = 25_000;   // cash price
const ONLINE = 23_000;  // card price — must never be used for a desk sale
const DEPOSIT = 5_000;

async function seed(seats = 13): Promise<void> {
  await db.update((d) => {
    d.users = []; d.wallets = []; d.transactions = [];
    d.bookings = []; d.registrations = []; d.clients = []; d.events = [];
    d.registrationFormFields = [];
    d.incubators = [
      { id: INC, name: 'QA Incubator', status: 'ACTIVE', managerId: MGR, email: 'i@x.dz' } as never,
    ];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation Community Manager', description: 'x', type: 'TRAINING', city: 'Oran',
        imageUrl: null, imageUrls: [], price: ONLINE, onlinePrice: ONLINE, cashPrice: TOTAL,
        seatsTotal: seats, seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z',
        startDate: '2030-02-01T11:00:00.000Z', startTime: '09:00',
        endDate: '2030-02-03T11:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'],
        cashDepositType: 'FIXED', cashDepositValue: DEPOSIT,
        isActive: true, slug: 'f', createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
  });
}

const WALKIN = {
  entityType: 'PROGRAM' as const,
  entityId: PROG,
  owner: incubatorScope(INC),
  actorId: MGR,
  fullName: 'Amina B.',
  email: 'amina@example.dz',
  phone: '+213700112233',
  answers: [],
  locale: 'fr',
  depositPaid: DEPOSIT,
};

beforeEach(async () => {
  sent.length = 0;
  await seed();
});

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('a walk-in who paid a deposit in cash', () => {
  it('appears in the participants list AND takes exactly one seat', async () => {
    const res = await addOfflineRegistration(WALKIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const d = await db.read();
    // In the participants list — this is what a manual booking never did.
    expect(d.registrations).toHaveLength(1);
    expect(d.registrations[0]!.status).toBe('CONFIRMED');
    expect(d.registrations[0]!.fullName).toBe('Amina B.');

    // Two records exist for one person...
    expect(d.bookings).toHaveLength(1);
    // ...and she is ONE seat. Both records are active and both would count on
    // their own; they dedupe on her email. 13 seats − 1 = 12 left.
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
  });

  it('records the deposit and the balance, and never touches a wallet', async () => {
    const res = await addOfflineRegistration(WALKIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalAmount).toBe(TOTAL);
    expect(res.depositPaid).toBe(DEPOSIT);
    expect(res.dueOnSite).toBe(TOTAL - DEPOSIT);

    const b = (await db.read()).bookings[0]!;
    expect(b.totalAmount).toBe(TOTAL);
    expect(b.cashDepositPaidAmount).toBe(DEPOSIT);
    expect(b.cashRemainingAmount).toBe(TOTAL - DEPOSIT);
    // The cash never went through a card rail, so nothing is "paid online" and
    // no commission was taken on it.
    expect(b.onlinePaidAmount).toBe(0);
    expect(b.commissionAmount ?? 0).toBe(0);
    expect(b.paymentMethod).toBe('manual');
    expect(b.source).toBe('offline');
    expect(b.paymentStatus).toBe('AWAITING_CASH');
    expect((await db.read()).transactions).toHaveLength(0);
  });

  it('prices from the CASH rate, not the card rate', async () => {
    const res = await addOfflineRegistration(WALKIN);
    expect(res.ok && res.totalAmount).toBe(TOTAL);
    expect(res.ok && res.totalAmount).not.toBe(ONLINE);
  });

  it('lets the host agree a different total at the desk', async () => {
    const res = await addOfflineRegistration({ ...WALKIN, totalAmount: 20_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalAmount).toBe(20_000);
    expect(res.dueOnSite).toBe(15_000);
  });

  it('emails her what she paid IN THE OFFICE and what is left', async () => {
    await addOfflineRegistration(WALKIN);
    await flush();

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('amina@example.dz');
    expect(mail.subject).toContain('Inscription confirmée');
    // Cash handed over at a desk is not "payé en ligne" — saying so is how a
    // receipt loses its reader.
    expect(mail.html).toContain('Payé sur place');
    expect(mail.html).not.toContain('Payé en ligne');
    expect(mail.html).toContain('À payer sur place');
    const digits = mail.html.replace(/[\s,  ]/g, '');
    expect(digits).toContain('5000DZD');
    expect(digits).toContain('20000DZD');
  });

  it('says nothing is owed when she paid the whole amount at the desk', async () => {
    const res = await addOfflineRegistration({ ...WALKIN, depositPaid: TOTAL });
    await flush();
    expect(res.ok && res.dueOnSite).toBe(0);
    const b = (await db.read()).bookings[0]!;
    expect(b.paymentStatus).toBe('PAID');
    expect(b.cashCollectedBy).toBe(MGR);
    expect(sent[0]!.html).toContain('Payé intégralement');
  });

  it('caps a deposit that exceeds the total rather than banking the excess', async () => {
    const res = await addOfflineRegistration({ ...WALKIN, depositPaid: 99_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.depositPaid).toBe(TOTAL);
    expect(res.dueOnSite).toBe(0);
  });

  it('seats someone who has paid nothing yet', async () => {
    const res = await addOfflineRegistration({ ...WALKIN, depositPaid: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dueOnSite).toBe(TOTAL);
    const d = await db.read();
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
    expect(d.bookings[0]!.cashDepositPaidAmount).toBeUndefined();
    expect(d.bookings[0]!.paymentStatus).toBe('AWAITING_CASH');
  });

  it('adds her to the CRM client list', async () => {
    await addOfflineRegistration(WALKIN);
    const clients = (await db.read()).clients;
    expect(clients).toHaveLength(1);
    expect(clients[0]!.incubatorId).toBe(INC);
    expect(clients[0]!.email).toBe('amina@example.dz');
  });
});

describe('closing the balance later', () => {
  it('"Mark cash paid" settles a desk booking, and is idempotent', async () => {
    await addOfflineRegistration(WALKIN);
    const booking = (await db.read()).bookings[0]!;

    const first = await markCashPaid({ bookingId: booking.id, isOwned: () => true, collectedByActorId: MGR });
    expect(first.ok).toBe(true);
    const after = (await db.read()).bookings[0]!;
    expect(after.paymentStatus).toBe('PAID');
    expect(after.cashCollectedBy).toBe(MGR);

    const second = await markCashPaid({ bookingId: booking.id, isOwned: () => true, collectedByActorId: MGR });
    expect(second.ok).toBe(true); // replay changes nothing
  });

  it('still refuses a plain manual booking that has no cash leg', async () => {
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-plain', userId: null, source: 'offline', paymentMethod: 'manual',
        itemKind: 'PROGRAM', itemId: PROG, itemName: 'x', vendorName: 'QA', city: 'Oran',
        unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW, totalAmount: 1_000,
        status: 'CONFIRMED', clientReference: 'manual-x', transactionId: null,
        createdAt: NOW, updatedAt: NOW,
      } as never);
    });
    const res = await markCashPaid({ bookingId: 'bk-plain', isOwned: () => true, collectedByActorId: MGR });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NOT_CASH_DEPOSIT');
  });
});

describe('guards', () => {
  it('refuses a second seat for the same email', async () => {
    await addOfflineRegistration(WALKIN);
    const again = await addOfflineRegistration(WALKIN);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('ALREADY_REGISTERED');
    const d = await db.read();
    expect(d.registrations).toHaveLength(1);
    expect(d.bookings).toHaveLength(1);
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
  });

  it('refuses when the room is full — counting registrations, not just bookings', async () => {
    await seed(1);
    // One seat, taken by someone who registered through the public link. A
    // bookings-only guard would not see this at all.
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Public', email: 'public@example.dz', phone: '+213700000001', answers: [],
    });
    const res = await addOfflineRegistration(WALKIN);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('FULL');
  });

  it('refuses a listing the acting owner does not own', async () => {
    const res = await addOfflineRegistration({ ...WALKIN, owner: incubatorScope('someone-else') });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NOT_FOUND');
  });

  it('demands the same required answers the public form demands', async () => {
    await db.update((d) => {
      d.registrationFormFields = [
        {
          id: 'field-city', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
          label: 'Ville', type: 'TEXT', required: true, options: null, order: 1,
          createdAt: NOW, updatedAt: NOW,
        } as never,
      ];
    });
    const res = await addOfflineRegistration(WALKIN);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('MISSING_REQUIRED_FIELD');
    if (res.reason !== 'MISSING_REQUIRED_FIELD') return;
    expect(res.label).toBe('Ville');

    const ok = await addOfflineRegistration({
      ...WALKIN,
      answers: [{ fieldId: 'field-city', value: 'Oran' }],
    });
    expect(ok.ok).toBe(true);
    expect((await db.read()).registrations[0]!.answers).toEqual([{ fieldId: 'field-city', value: 'Oran' }]);
  });
});

/* ═══════════ Regressions found while reviewing the work above ═══════════ */

describe('a waitlisted registration', () => {
  it('gets NO booking — no debt, and no seat held behind the waitlist', async () => {
    await seed(1);
    // Fill the single seat, so the next registration can only be waitlisted.
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'First', email: 'first@example.dz', phone: '+213700000001', answers: [],
    });

    // Reach insertRegistrationSync directly: `addOfflineRegistration` refuses a
    // full room up front, so this is the race where the last seat goes between
    // the capacity read and the write.
    const { createRegistration: create } = await import('@/server/registrations/service');
    const res = await create({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Late', email: 'late@example.dz', phone: '+213700000002', answers: [],
      locale: 'fr',
      cashReservation: {
        listing: {
          id: PROG, title: 'Formation', vendorName: 'QA Incubator', city: 'Oran',
          startsAt: '2030-02-01T09:00:00.000Z', endsAt: '2030-02-03T11:00:00.000Z',
        },
        amountDue: TOTAL, clientReference: `desk-${PROG}-late@example.dz`,
        depositPaidAmount: DEPOSIT, offline: true, collectedByActorId: MGR,
      },
    });

    expect(res.registration.status).toBe('WAITLISTED');
    const d = await db.read();
    // No money row for a place they do not have...
    expect(d.bookings).toHaveLength(0);
    // ...and the room is still exactly full, not overbooked by the offline
    // booking that used to be written CONFIRMED regardless of status.
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
  });
});

describe('paying by card for a seat already reserved in cash', () => {
  it('moves the registration onto the paid booking and clears the cash debt', async () => {
    // A cash-on-site reservation made through the public link.
    await createRegistration({
      entityType: 'PROGRAM', entityId: PROG, userId: null,
      fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213700112233',
      answers: [], locale: 'fr',
      cashReservation: {
        listing: {
          id: PROG, title: 'Formation', vendorName: 'QA Incubator', city: 'Oran',
          startsAt: '2030-02-01T09:00:00.000Z', endsAt: '2030-02-03T11:00:00.000Z',
        },
        amountDue: TOTAL, clientReference: `cash-${PROG}-amina@example.dz`,
      },
    });
    const cashBookingId = (await db.read()).bookings[0]!.id;
    expect((await db.read()).registrations[0]!.bookingId).toBe(cashBookingId);

    // She then pays by card. Settlement calls insertRegistrationSync with the
    // settled booking id.
    const { insertRegistrationSync } = await import('@/server/registrations/service');
    await db.update((d) => {
      d.bookings.push({
        id: 'bk-card', userId: null, source: 'online', paymentMethod: 'card',
        itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation', vendorName: 'QA Incubator',
        city: 'Oran', unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW,
        totalAmount: TOTAL, status: 'CONFIRMED', clientReference: 'ref-card',
        clientEmail: 'amina@example.dz', paymentMode: 'ONLINE_FULL', onlinePaidAmount: TOTAL,
        transactionId: null, createdAt: NOW, updatedAt: NOW,
      } as never);
      insertRegistrationSync(d, {
        entityType: 'PROGRAM', entityId: PROG, userId: null,
        fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213700112233',
        answers: [], locale: 'fr', bookingId: 'bk-card',
      });
    });

    const d = await db.read();
    // The row follows the money — otherwise the receipt, which finds the
    // registration BY booking id, never goes out for a payment that happened.
    expect(d.registrations).toHaveLength(1);
    expect(d.registrations[0]!.bookingId).toBe('bk-card');
    expect(d.registrations[0]!.status).toBe('CONFIRMED');
    // The cash hold is closed, so the host is not shown a debt she just paid.
    expect(d.bookings.find((b) => b.id === cashBookingId)!.status).toBe('CANCELLED');
    // And it is still one seat.
    expect(countAttendance(d, 'PROGRAM', PROG)).toBe(1);
  });

  it('does not let a second payment steal a registration that is already paid', async () => {
    await addOfflineRegistration({ ...WALKIN, depositPaid: TOTAL });
    const deskBookingId = (await db.read()).registrations[0]!.bookingId;

    const { insertRegistrationSync } = await import('@/server/registrations/service');
    await db.update((d) => {
      insertRegistrationSync(d, {
        entityType: 'PROGRAM', entityId: PROG, userId: null,
        fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213700112233',
        answers: [], bookingId: 'bk-other',
      });
    });

    // The desk booking is CONFIRMED, not a pending hold — it stands.
    expect((await db.read()).registrations[0]!.bookingId).toBe(deskBookingId);
  });
});

describe('the consultant surface', () => {
  const MENTOR = 'mentor-desk';
  const MPROG = 'prog-mentor-desk';

  beforeEach(async () => {
    await db.update((d) => {
      d.mentors = [
        { id: MENTOR, fullName: 'QA Consultant', email: 'm@example.dz', phone: '+213700000009',
          status: 'APPROVED', isApproved: true, createdAt: NOW, updatedAt: NOW } as never,
      ];
      d.programs.push({
        id: MPROG, incubatorId: null, incubatorName: null, mentorId: MENTOR, mentorName: 'QA Consultant',
        title: 'Atelier Consultant', description: 'x', type: 'TRAINING', city: 'Alger',
        imageUrl: null, imageUrls: [], price: ONLINE, onlinePrice: ONLINE, cashPrice: TOTAL,
        seatsTotal: 5, seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z',
        startDate: '2030-02-01T11:00:00.000Z', endDate: '2030-02-03T11:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'atelier',
        createdAt: NOW, updatedAt: NOW,
      } as never);
    });
  });

  it('seats a walk-in on a consultant-owned program', async () => {
    const { mentorScope } = await import('@/server/registrations/service');
    const res = await addOfflineRegistration({
      ...WALKIN, entityId: MPROG, owner: mentorScope(MENTOR), actorId: MENTOR,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalAmount).toBe(TOTAL);

    const d = await db.read();
    const reg = d.registrations.find((r) => r.entityId === MPROG)!;
    // Owner scoping: a consultant-owned row registers against the CONSULTANT,
    // never against an incubator that happens to be nearby.
    expect(reg.mentorId).toBe(MENTOR);
    expect(reg.incubatorId).toBeNull();
    expect(countAttendance(d, 'PROGRAM', MPROG)).toBe(1);
    // Consultants have no CRM — the client upsert is an incubator concept.
    expect(d.clients.filter((c) => c.email === 'amina@example.dz')).toHaveLength(0);
  });

  it('refuses an incubator reaching for a consultant-owned program', async () => {
    const res = await addOfflineRegistration({
      ...WALKIN, entityId: MPROG, owner: incubatorScope(INC),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NOT_FOUND');
  });
});
