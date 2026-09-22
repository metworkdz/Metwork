/**
 * A receipt is owed to whoever paid — not to whoever paid BY CARD.
 *
 * `dispatchReceiptIfDue` opened with `if (b.paymentMethod !== 'card') return`,
 * so every cash booking got nothing: the desk walk-ins, the offline bookings,
 * and every space settled on site. Both "mark cash paid" routes called it at
 * the exact moment a receipt was due and it returned without doing anything.
 *
 * On the live store when this was found: of 23 program bookings, the 3 paid by
 * card had receipts and the 6 confirmed cash ones had none. Of 13 space
 * bookings, zero.
 *
 * Nothing about the PDF changed — it already printed the program name, its
 * dates and the incubator's stamp. Only the gate was wrong, so these tests are
 * about WHEN a receipt goes out and when it must not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { dispatchReceiptIfDue } from '@/server/bookings/card-payment';

const INC = 'inc-cash-receipt';
const PROG = 'prog-cash-receipt';
const NOW = '2026-09-01T00:00:00.000Z';

function booking(over: Record<string, unknown> = {}) {
  return {
    id: 'bk-cash', userId: null, source: 'offline', paymentMethod: 'manual',
    itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation Community Manager',
    vendorName: 'QA Incubator', city: 'Oran', unit: 'DAY', quantity: 1,
    startsAt: '2030-02-01T12:00:00.000Z', endsAt: '2030-02-03T12:00:00.000Z',
    totalAmount: 23_000, status: 'CONFIRMED',
    clientReference: 'desk-1', clientName: 'Amina B.', clientEmail: 'amina@example.dz',
    clientPhone: '+213770112233', transactionId: null,
    paymentMode: 'CASH_DEPOSIT', onlinePaidAmount: 0,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  } as never;
}

async function seed(bookings: unknown[]): Promise<void> {
  await db.update((d) => {
    d.users = []; d.mentors = []; d.registrations = [];
    d.incubators = [
      {
        id: INC, name: 'QA Incubator', city: 'Oran', status: 'ACTIVE', managerId: 'mgr',
        email: 'i@x.dz', stampUrl: null, logoUrl: null,
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
    d.programs = [
      {
        id: PROG, incubatorId: INC, incubatorName: 'QA Incubator', mentorId: null,
        title: 'Formation Community Manager', description: 'x', type: 'TRAINING', city: 'Oran',
        imageUrl: null, imageUrls: [], price: 23_000, seatsTotal: 13, seatsTaken: 0,
        deadline: '2030-01-01T12:00:00.000Z',
        startDate: '2030-02-01T12:00:00.000Z', endDate: '2030-02-03T12:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'], isActive: true, slug: 'f',
        createdAt: NOW, updatedAt: NOW,
      } as never,
    ];
    d.bookings = bookings as never[];
  });
}

const stamp = async (id = 'bk-cash') =>
  (await db.read()).bookings.find((b) => b.id === id);

beforeEach(() => { sent.length = 0; });

describe('cash gets a receipt', () => {
  it('sends one for a walk-in who paid in full — the bug', async () => {
    await seed([booking({ paymentStatus: 'PAID', cashDepositPaidAmount: 23_000, cashRemainingAmount: 0 })]);
    await dispatchReceiptIfDue('bk-cash');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('amina@example.dz');
    // The whole point: a PDF, not just an email.
    expect(sent[0]!.attachments).toHaveLength(1);
    expect((await stamp())!.finalReceiptSentAt).toBeTruthy();
  });

  it('sends a deposit receipt when only a deposit was handed over', async () => {
    await seed([booking({
      paymentStatus: 'AWAITING_CASH', cashDepositPaidAmount: 5_000, cashRemainingAmount: 18_000,
    })]);
    await dispatchReceiptIfDue('bk-cash');

    expect(sent).toHaveLength(1);
    expect((await stamp())!.depositReceiptSentAt).toBeTruthy();
    expect((await stamp())!.finalReceiptSentAt).toBeFalsy();
  });

  it('still sends for a card booking — the path that already worked', async () => {
    await seed([booking({ paymentMethod: 'card', paymentMode: undefined, paymentStatus: 'PAID' })]);
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(1);
  });

  it('sends for a space exactly as for a program', async () => {
    await seed([booking({ itemKind: 'SPACE', itemId: 'sp-1', itemName: 'Bureau privé', paymentStatus: 'PAID' })]);
    await db.update((d) => {
      d.spaces = [{ id: 'sp-1', incubatorId: INC, name: 'Bureau privé', city: 'Oran' } as never];
    });
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(1);
  });
});

describe('when a receipt must NOT go out', () => {
  it('sends nothing twice, however many times it is called', async () => {
    await seed([booking({ paymentStatus: 'PAID' })]);
    await dispatchReceiptIfDue('bk-cash');
    await dispatchReceiptIfDue('bk-cash');
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(1);
  });

  it('sends nothing for a reservation where no money has been received', async () => {
    // A desk reservation taken with no deposit: she owes 23 000 and has paid
    // nothing. A receipt would say money changed hands when none did.
    await seed([booking({
      paymentStatus: 'AWAITING_CASH', cashDepositPaidAmount: 0, cashRemainingAmount: 23_000,
    })]);
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(0);
    expect((await stamp())!.depositReceiptSentAt).toBeFalsy();
  });

  it('sends nothing for an unpaid intent', async () => {
    await seed([booking({ status: 'PENDING_PAYMENT', paymentStatus: undefined })]);
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(0);
  });

  it('sends nothing for a cancelled booking', async () => {
    // Reaching CANCELLED with paymentStatus PAID and no receipt yet is the
    // shape a late cancellation leaves; a receipt arriving after it reads as
    // a billing error.
    await seed([booking({ status: 'CANCELLED', paymentStatus: 'PAID' })]);
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when there is no address to send to', async () => {
    await seed([booking({ paymentStatus: 'PAID', clientEmail: '' })]);
    await dispatchReceiptIfDue('bk-cash');
    expect(sent).toHaveLength(0);
  });

  it('does not throw on a booking that does not exist', async () => {
    await seed([]);
    await expect(dispatchReceiptIfDue('no-such-booking')).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});
