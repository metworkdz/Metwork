/**
 * Fixing a participant's details, and sending their paperwork again.
 *
 * Two things here are easy to get wrong and expensive when you do:
 *
 *  1. A registration and its booking EACH carry the person's name and email.
 *     Editing one and not the other sends the receipt to the old address
 *     while the participants list shows the new one — and on a paid booking
 *     the name is part of a financial record.
 *
 *  2. Attendance de-duplicates by lowercased email. Editing one registration's
 *     address to match another's on the same program would silently merge two
 *     participants into one seat, which is a seat somebody paid for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as EmailModule from '@/server/notifications/email';

const sent: Array<{ to: string; subject: string; attachments?: unknown[] }> = [];
vi.mock('@/server/notifications/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return {
    ...actual,
    sendResendEmail: async (o: { to: string; subject: string; attachments?: unknown[] }) => {
      sent.push(o);
      return true;
    },
  };
});

import { db } from '@/server/db/store';
import {
  updateRegistration, resendRegistrationConfirmation, incubatorScope, mentorScope,
} from '@/server/registrations/service';
import { countAttendance } from '@/server/attendance';

const INC = 'inc-edit';
const PROG = 'prog-edit';
const NOW = '2026-09-01T00:00:00.000Z';
const owner = () => incubatorScope(INC);

function registration(over: Record<string, unknown> = {}) {
  return {
    id: 'reg-1', entityType: 'PROGRAM', entityId: PROG, incubatorId: INC, mentorId: null,
    userId: null, fullName: 'Amina B.', email: 'amina@example.dz', phone: '+213770112233',
    answers: [{ fieldId: 'f-city', value: 'Oran' }],
    status: 'CONFIRMED', clientId: null, bookingId: 'bk-1',
    createdAt: NOW, updatedAt: NOW,
    ...over,
  } as never;
}

function booking(over: Record<string, unknown> = {}) {
  return {
    id: 'bk-1', userId: null, source: 'offline', paymentMethod: 'manual',
    itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation', vendorName: 'QA',
    city: 'Oran', unit: 'DAY', quantity: 1, startsAt: NOW, endsAt: NOW,
    totalAmount: 23_000, status: 'CONFIRMED', paymentStatus: 'PAID',
    paymentMode: 'CASH_DEPOSIT', cashDepositPaidAmount: 23_000, cashRemainingAmount: 0,
    clientReference: 'desk-1', clientName: 'Amina B.', clientEmail: 'amina@example.dz',
    clientPhone: '+213770112233', transactionId: null,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  } as never;
}

async function seed(regs: unknown[] = [registration()], bks: unknown[] = [booking()]): Promise<void> {
  await db.update((d) => {
    d.users = []; d.mentors = []; d.clients = []; d.registrationFormFields = [];
    d.incubators = [
      { id: INC, name: 'QA Incubator', city: 'Oran', status: 'ACTIVE', managerId: 'm',
        email: 'i@x.dz', createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.programs = [
      { id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation', description: 'x', type: 'TRAINING', city: 'Oran',
        imageUrl: null, imageUrls: [], price: 23_000, seatsTotal: 13, seatsTaken: 0,
        deadline: '2030-01-01T12:00:00.000Z',
        startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-03T12:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'f',
        createdAt: NOW, updatedAt: NOW } as never,
    ];
    d.registrations = regs as never[];
    d.bookings = bks as never[];
  });
}

const reg = async (id = 'reg-1') => (await db.read()).registrations.find((r) => r.id === id);
const bk = async (id = 'bk-1') => (await db.read()).bookings.find((b) => b.id === id);

beforeEach(async () => { sent.length = 0; await seed(); });

describe('editing a participant', () => {
  it('writes the registration AND its booking', async () => {
    const res = await updateRegistration('reg-1', owner(), {
      fullName: 'Amina Benali', email: 'amina.benali@example.dz', phone: '+213770998877',
    });
    expect(res.ok).toBe(true);

    expect((await reg())!.fullName).toBe('Amina Benali');
    expect((await reg())!.email).toBe('amina.benali@example.dz');
    // The half that is easy to forget.
    expect((await bk())!.clientName).toBe('Amina Benali');
    expect((await bk())!.clientEmail).toBe('amina.benali@example.dz');
    expect((await bk())!.clientPhone).toBe('+213770998877');
  });

  it('changes only what was passed', async () => {
    await updateRegistration('reg-1', owner(), { phone: '+213770000000' });
    const r = (await reg())!;
    expect(r.phone).toBe('+213770000000');
    expect(r.fullName).toBe('Amina B.');
    expect(r.email).toBe('amina@example.dz');
    // Not the answers, not the status — this is for fixing a typo.
    expect(r.answers).toEqual([{ fieldId: 'f-city', value: 'Oran' }]);
    expect(r.status).toBe('CONFIRMED');
  });

  it('lowercases the email, as the rest of the system reads it', async () => {
    await updateRegistration('reg-1', owner(), { email: 'Amina.B@Example.DZ' });
    expect((await reg())!.email).toBe('amina.b@example.dz');
  });

  it('stamps updatedAt', async () => {
    await updateRegistration('reg-1', owner(), { fullName: 'X' });
    expect((await reg())!.updatedAt).not.toBe(NOW);
  });

  it('works on a free registration that has no booking', async () => {
    await seed([registration({ bookingId: null })], []);
    expect((await updateRegistration('reg-1', owner(), { fullName: 'Solo' })).ok).toBe(true);
    expect((await reg())!.fullName).toBe('Solo');
  });
});

describe('the seat-merging guard', () => {
  it('refuses an email already used by another participant on the same program', async () => {
    await seed([
      registration(),
      registration({ id: 'reg-2', email: 'karim@example.dz', bookingId: null }),
    ], [booking()]);

    const res = await updateRegistration('reg-1', owner(), { email: 'karim@example.dz' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('EMAIL_TAKEN');
    expect((await reg())!.email).toBe('amina@example.dz');
  });

  it('catches it whatever the casing', async () => {
    await seed([
      registration(),
      registration({ id: 'reg-2', email: 'karim@example.dz', bookingId: null }),
    ], [booking()]);
    expect((await updateRegistration('reg-1', owner(), { email: 'KARIM@Example.dz' })).ok).toBe(false);
  });

  it('would have merged two people into one seat — the reason for the guard', async () => {
    await seed([
      registration(),
      registration({ id: 'reg-2', email: 'karim@example.dz', bookingId: null }),
    ], [booking()]);
    const before = countAttendance(await db.read(), 'PROGRAM', PROG);
    await updateRegistration('reg-1', owner(), { email: 'karim@example.dz' });
    expect(countAttendance(await db.read(), 'PROGRAM', PROG)).toBe(before);
  });

  it('allows an address freed by a CANCELLED registration', async () => {
    await seed([
      registration(),
      registration({ id: 'reg-2', email: 'karim@example.dz', status: 'CANCELLED', bookingId: null }),
    ], [booking()]);
    expect((await updateRegistration('reg-1', owner(), { email: 'karim@example.dz' })).ok).toBe(true);
  });

  it('lets someone keep their own address', async () => {
    expect((await updateRegistration('reg-1', owner(), {
      email: 'amina@example.dz', fullName: 'Amina B.',
    })).ok).toBe(true);
  });

  it('does not collide with the same address on a DIFFERENT program', async () => {
    await seed([
      registration(),
      registration({ id: 'reg-2', entityId: 'another-program', email: 'karim@example.dz', bookingId: null }),
    ], [booking()]);
    expect((await updateRegistration('reg-1', owner(), { email: 'karim@example.dz' })).ok).toBe(true);
  });
});

describe('who may edit', () => {
  it('refuses another owner without revealing the row exists', async () => {
    const res = await updateRegistration('reg-1', incubatorScope('someone-else'), { fullName: 'X' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NOT_FOUND');
    expect((await reg())!.fullName).toBe('Amina B.');
  });

  it('refuses a consultant who does not own the program', async () => {
    expect((await updateRegistration('reg-1', mentorScope('a-consultant'), { fullName: 'X' })).ok).toBe(false);
  });
});

describe('resending the paperwork', () => {
  it('sends the confirmation and the receipt again', async () => {
    await db.update((d) => {
      d.registrations[0]!.confirmationSentAt = NOW;
      d.bookings[0]!.finalReceiptSentAt = NOW;
    });
    sent.length = 0;

    const res = await resendRegistrationConfirmation('reg-1', owner());
    expect(res.ok).toBe(true);
    // One confirmation + one receipt, the receipt carrying its PDF.
    expect(sent.length).toBe(2);
    expect(sent.some((m) => m.attachments?.length)).toBe(true);
  });

  it('sends to the CORRECTED address after an edit', async () => {
    await db.update((d) => {
      d.registrations[0]!.confirmationSentAt = NOW;
      d.bookings[0]!.finalReceiptSentAt = NOW;
    });
    await updateRegistration('reg-1', owner(), { email: 'fixed@example.dz' });
    sent.length = 0;

    await resendRegistrationConfirmation('reg-1', owner());
    expect(sent.length).toBeGreaterThan(0);
    for (const mail of sent) expect(mail.to).toBe('fixed@example.dz');
  });

  it('puts the exactly-once stamps back, so settlement cannot re-send', async () => {
    await resendRegistrationConfirmation('reg-1', owner());
    // Both claimed again by the dispatchers themselves.
    expect((await reg())!.confirmationSentAt).toBeTruthy();
    expect((await bk())!.finalReceiptSentAt).toBeTruthy();
  });

  it('sends no receipt when no money was received', async () => {
    await seed([registration()], [booking({
      paymentStatus: 'AWAITING_CASH', cashDepositPaidAmount: 0, cashRemainingAmount: 23_000,
      finalReceiptSentAt: null,
    })]);
    sent.length = 0;

    const res = await resendRegistrationConfirmation('reg-1', owner());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sentReceipt).toBe(false);
    expect(sent.every((m) => !m.attachments?.length)).toBe(true);
  });

  it('refuses another owner', async () => {
    const res = await resendRegistrationConfirmation('reg-1', incubatorScope('someone-else'));
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('reports a missing registration as not found', async () => {
    expect((await resendRegistrationConfirmation('no-such-id', owner())).ok).toBe(false);
  });
});
