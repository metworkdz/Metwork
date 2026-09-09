/**
 * Two things a paying client sees, both of which were wrong.
 *
 * 1. THE RECEIPT NEVER ARRIVED for a consultant-owned listing.
 *    `dispatchCardReceiptIfDue` resolved only an owning INCUBATOR and returned
 *    early when there wasn't one, so a client who paid a consultant got the
 *    registration confirmation and nothing else — no receipt, no PDF, no record
 *    of what they paid. The consultant's mark-cash-paid route carried a comment
 *    admitting the same gap for the final receipt.
 *
 * 2. A START TIME NOBODY ENTERED. Programs and events are authored with plain
 *    date inputs and stored anchored at noon local so the day survives timezone
 *    conversion. Rendering that with a clock invented a start time: in Algeria
 *    (UTC+1) the anchor reads back as 11:00, and that is what a client saw on
 *    the screen where they pay, and again on their receipt.
 *
 * The receipt is generated inside one try/catch that covers BOTH the PDF and
 * the email, so anything that throws mid-render silently costs the client the
 * whole message. That is why the locale fallback below is a test and not a
 * comment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as EmailModule from '@/server/notifications/email';

const sent: Array<{ to: string; subject: string; html: string; attachments?: unknown[] }> = [];
vi.mock('@/server/notifications/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return {
    ...actual,
    sendResendEmail: async (o: { to: string; subject: string; html: string; attachments?: unknown[] }) => {
      sent.push(o);
      return true;
    },
  };
});

import { db } from '@/server/db/store';
import { settleCardBookingFromWebhook } from '@/server/bookings/card-payment';
import { sendBookingReceiptEmailAsync } from '@/server/notifications/mock';
import { listingHasClockTime, formatBookingWhen } from '@/lib/booking-when';

const INC = 'inc-r';
const MGR = 'mgr-r';
const MENTOR = 'mentor-r';
const PROG = 'prog-r';
const CLIENT = 'client@example.dz';

/** Noon local in Algeria (UTC+1) — exactly what the program form stores. */
const NOON_ANCHOR = '2030-02-01T11:00:00.000Z';

type Owner = 'incubator' | 'consultant';

async function seed(owner: Owner, mode: 'ONLINE_FULL' | 'CASH_DEPOSIT'): Promise<void> {
  await db.update((d) => {
    d.incubators = [
      { id: INC, name: 'QA Incubator', status: 'ACTIVE', managerId: MGR, email: 'inc@x.dz' } as never,
    ];
    d.mentors = [
      {
        id: MENTOR, fullName: 'Sara Consultant', email: 'sara@x.dz', phone: '+213700000001',
        city: 'Alger', imageUrl: null, status: 'APPROVED', isApproved: true,
      } as never,
    ];
    d.users = [{ id: MGR, email: 'inc@x.dz', fullName: 'Manager', role: 'INCUBATOR' } as never];
    d.wallets = []; d.transactions = []; d.registrations = []; d.clients = [];
    d.events = []; d.commissionRules = [];
    d.programs = [
      {
        id: PROG,
        incubatorId: owner === 'incubator' ? INC : null,
        incubatorName: 'QA Incubator',
        mentorId: owner === 'consultant' ? MENTOR : null,
        mentorName: owner === 'consultant' ? 'Sara Consultant' : null,
        title: 'Formation Entrepreneuriat', description: 'x', type: 'TRAINING', city: 'Alger',
        imageUrl: null, imageUrls: [], price: 24_000, onlinePrice: 22_000, cashPrice: 24_000,
        seatsTotal: 20, seatsTaken: 0,
        deadline: '2030-01-01T00:00:00.000Z', startDate: NOON_ANCHOR, endDate: '2030-03-01T11:00:00.000Z',
        acceptedPaymentMethods: ['ONLINE', 'CASH'], cashDepositType: 'PERCENT', cashDepositValue: 25,
        isActive: true, slug: 'f',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } as never,
    ];
    d.bookings = [
      {
        id: 'bk-r', userId: null, source: 'online', paymentMethod: 'card',
        itemKind: 'PROGRAM', itemId: PROG, itemName: 'Formation Entrepreneuriat',
        vendorName: 'QA', city: 'Alger', unit: 'DAY', quantity: 1,
        startsAt: NOON_ANCHOR, endsAt: '2030-03-01T11:00:00.000Z',
        totalAmount: mode === 'CASH_DEPOSIT' ? 24_000 : 22_000,
        status: 'PENDING_PAYMENT', clientReference: 'ref-aaaaaaaa',
        clientName: 'Karim', clientEmail: CLIENT, clientPhone: '+213700112233',
        paymentMode: mode,
        onlinePaidAmount: mode === 'CASH_DEPOSIT' ? 6_000 : 22_000,
        cashRemainingAmount: mode === 'CASH_DEPOSIT' ? 18_000 : 0,
        onlineChargeAmount: mode === 'CASH_DEPOSIT' ? 6_120 : 22_440,
        settledAt: null, payToken: 'tok-r', bookingLocale: 'fr',
        registrationDraft: { entityType: 'PROGRAM', answers: [], locale: 'fr' },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } as never,
    ];
  });
}

/** Emails are fire-and-forget; let the PDF render and the send resolve. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600));
}

function receipts() {
  return sent.filter((m) => m.to === CLIENT && /reçu|receipt/i.test(m.subject));
}

beforeEach(() => {
  sent.length = 0;
});

/* ══════════════════ 1. The receipt reaches the client ══════════════════ */

describe('the payment receipt', () => {
  for (const owner of ['incubator', 'consultant'] as const) {
    it(`is sent in full for an ONLINE payment on a ${owner}-owned program`, async () => {
      await seed(owner, 'ONLINE_FULL');
      await settleCardBookingFromWebhook('bk-r', 'prov', 'COMPLETED');
      await flush();

      const got = receipts();
      expect(got, `${owner}: no receipt reached the client`).toHaveLength(1);
      // Paid in full → the 'final' variant, with the PDF attached.
      expect(got[0]!.subject).toMatch(/payé|paid in full/i);
      expect(got[0]!.attachments).toHaveLength(1);
    });

    it(`is sent as a DEPOSIT receipt for a cash booking on a ${owner}-owned program`, async () => {
      await seed(owner, 'CASH_DEPOSIT');
      await settleCardBookingFromWebhook('bk-r', 'prov', 'COMPLETED');
      await flush();

      const got = receipts();
      expect(got, `${owner}: no deposit receipt reached the client`).toHaveLength(1);
      expect(got[0]!.subject).toMatch(/acompte|deposit/i);
      expect(got[0]!.attachments).toHaveLength(1);
    });
  }

  it('carries the consultant as the letterhead, not a blank vendor', async () => {
    await seed('consultant', 'ONLINE_FULL');
    await settleCardBookingFromWebhook('bk-r', 'prov', 'COMPLETED');
    await flush();
    expect(receipts()[0]!.subject).toContain('Sara Consultant');
  });

  it('is not sent twice when settlement replays', async () => {
    await seed('incubator', 'ONLINE_FULL');
    await settleCardBookingFromWebhook('bk-r', 'prov', 'COMPLETED');
    await settleCardBookingFromWebhook('bk-r', 'prov', 'COMPLETED');
    await flush();
    expect(receipts()).toHaveLength(1);
  });

  it('survives an unsupported locale instead of silently sending nothing', async () => {
    // The copy map is en|fr, but callers derive `lang` from a user locale that
    // can be 'ar'. Indexing it to undefined used to throw inside the shared
    // try/catch and cost the client the entire email.
    const incubator = { name: 'QA Incubator', email: 'inc@x.dz' } as never;
    const booking = {
      itemKind: 'PROGRAM', itemName: 'Formation', clientReference: 'ref-bbbbbbbb',
      startsAt: NOON_ANCHOR, endsAt: '2030-03-01T11:00:00.000Z', totalAmount: 22_000,
      unit: 'DAY', paymentMethod: 'card', paymentMode: 'ONLINE_FULL', paymentStatus: 'PAID',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never;

    await sendBookingReceiptEmailAsync({
      booking, clientName: 'Karim', clientEmail: CLIENT, incubator,
      lang: 'ar' as never,
    });
    await flush();
    expect(sent.filter((m) => m.to === CLIENT)).toHaveLength(1);
  });
});

/* ══════════════════ 2. No invented start time ══════════════════ */

describe('booking timestamps', () => {
  it('knows which listing kinds actually carry a clock time', () => {
    expect(listingHasClockTime('SPACE')).toBe(true);
    expect(listingHasClockTime('PROGRAM')).toBe(false);
    expect(listingHasClockTime('EVENT')).toBe(false);
    expect(listingHasClockTime(undefined)).toBe(false);
  });

  it('shows a program date with NO time — the noon anchor is not 11:00', () => {
    const out = formatBookingWhen(NOON_ANCHOR, { intlLocale: 'fr-DZ', kind: 'PROGRAM' })!;
    expect(out).not.toMatch(/11[:h]/);
    expect(out).toMatch(/2030/);
  });

  it('still shows the clock for a space booking, where it is real', () => {
    const dated = formatBookingWhen('2030-02-01T09:30:00.000Z', { intlLocale: 'fr-DZ', kind: 'SPACE' })!;
    const undated = formatBookingWhen('2030-02-01T09:30:00.000Z', { intlLocale: 'fr-DZ', kind: 'PROGRAM' })!;
    // Assert on the DIFFERENCE, not on a literal: the exact clock rendering
    // depends on the ICU data the runtime ships (fr-DZ can come out 12-hour).
    expect(dated).toMatch(/\d[:h.]\d\d/);
    expect(dated.length).toBeGreaterThan(undated.length);
    expect(undated).not.toMatch(/\d[:h.]\d\d/);
  });

  it('keeps the invented time off the receipt email too', async () => {
    await seed('incubator', 'ONLINE_FULL');
    await settleCardBookingFromWebhook('bk-r', 'prov', 'COMPLETED');
    await flush();

    const html = receipts()[0]!.html;
    // The dates block must name the day without a fabricated hour.
    expect(html).toMatch(/2030/);
    expect(html, 'the receipt still prints the noon anchor as a start time')
      .not.toMatch(/01 février 2030[^<]*11:00/);
  });
});
