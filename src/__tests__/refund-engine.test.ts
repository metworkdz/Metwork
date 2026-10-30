/**
 * Refund engine: the consultant-ledger reversal (with debt), and the request →
 * accept → account → paid lifecycle for a guest (bank) and a registered client
 * (wallet). Runs on the real db.update critical section over the in-memory store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  db,
  type BookingRecord,
  type IncubatorRecord,
  type MentorBookingRecord,
  type TransactionRecord,
  type UserRecord,
} from '@/server/db/store';

const sent: Array<Record<string, unknown>> = [];
vi.mock('@/server/notifications/refund-emails', () => ({
  sendRefundEmail: vi.fn(async (input: Record<string, unknown>) => { sent.push(input); return true; }),
}));
vi.mock('@/server/notifications/create-notification', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/server/mentors/slot-lock', () => ({ releaseSlot: vi.fn(async () => undefined) }));

import { applyMentorEarningToDraft, reverseSaleInDraft } from '@/server/mentors/ledger';
import { getConsultationRevenueSummary } from '@/server/mentors/revenue';
import {
  acceptRefund, getAccountLinkView, markRefundPaid, recordOffPlatformRefund,
  rejectRefund, requestRefund, submitRefundAccount,
} from '@/server/refunds/service';
import { buildIncomingView } from '@/server/payments/incoming';

const MENTOR = 'mentor-1';
const ADMIN = 'admin-1';
const now = () => new Date().toISOString();

function programBooking(over: Partial<BookingRecord> = {}): BookingRecord {
  return {
    id: 'bk-1', userId: null, itemKind: 'PROGRAM', itemId: 'prog-1', itemName: 'Formation', vendorName: 'Consultant',
    city: '', unit: 'DAY', quantity: 1, startsAt: now(), endsAt: now(), totalAmount: 10_000, status: 'CONFIRMED',
    clientReference: 'ref-1', transactionId: null, paymentMethod: 'card', paymentMode: 'ONLINE_FULL',
    onlinePaidAmount: 10_000, onlineChargeAmount: 10_000, settledAt: now(), paymentStatus: 'PAID',
    clientName: 'Guest Client', clientEmail: 'guest@example.com', mentorCommissionRate: 0.05,
    createdAt: now(), updatedAt: now(), ...over,
  } as unknown as BookingRecord;
}

async function seedConsultantProgramSale(over: Partial<BookingRecord> = {}) {
  await db.update((d) => {
    d.mentors = [{ id: MENTOR, fullName: 'Trainer', email: 't@example.com' } as never];
    d.programs = [{ id: 'prog-1', mentorId: MENTOR, incubatorId: null } as never];
    d.users.push({ id: ADMIN, role: 'ADMIN', email: 'a@example.com', fullName: 'Admin', status: 'ACTIVE' } as unknown as UserRecord);
    const booking = programBooking(over);
    d.bookings.push(booking);
    applyMentorEarningToDraft(d, {
      mentorId: MENTOR, bookingId: booking.id, grossAmount: 10_000, kind: 'PROGRAM', bucket: 'AVAILABLE', frozenPlatformRate: 0.05,
    });
  });
}

const wallet = async () => (await db.read()).mentorWallets!.find((w) => w.mentorId === MENTOR)!;

beforeEach(() => { sent.length = 0; });

describe('reverseSaleInDraft', () => {
  it('takes the earning back from AVAILABLE and marks earning + commission REVERSED', async () => {
    await seedConsultantProgramSale();
    expect((await wallet()).availableBalance).toBe(9_500);

    const r = await db.update((d) => reverseSaleInDraft(d, { mentorId: MENTOR, bookingId: 'bk-1' }));
    expect(r).toMatchObject({ ok: true, replayed: false, reversed: 9_500, fromAvailable: 9_500, debtAdded: 0 });
    expect(await wallet()).toMatchObject({ availableBalance: 0 });

    const txns = (await db.read()).mentorLedgerTxns!;
    expect(txns.find((t) => t.reference === 'mentor-earning-bk-1')!.status).toBe('REVERSED');
    expect(txns.find((t) => t.reference === 'mentor-commission-bk-1')!.status).toBe('REVERSED');
    // The fee no longer counts as platform revenue.
    expect((await getConsultationRevenueSummary()).grossCommission).toBe(0);
  });

  it('records a debt when the consultant already withdrew, and nets it against the next earning', async () => {
    await seedConsultantProgramSale();
    await db.update((d) => { d.mentorWallets![0]!.availableBalance = 0; }); // withdrawn

    const r = await db.update((d) => reverseSaleInDraft(d, { mentorId: MENTOR, bookingId: 'bk-1' }));
    expect(r).toMatchObject({ ok: true, fromAvailable: 0, debtAdded: 9_500 });
    expect((await wallet()).debtBalance).toBe(9_500);

    // A later 20 000 sale repays the debt first: only 10 500 (of 19 000 net at 5%) is withdrawable.
    await db.update((d) => {
      applyMentorEarningToDraft(d, { mentorId: MENTOR, bookingId: 'bk-2', grossAmount: 20_000, kind: 'PROGRAM', bucket: 'AVAILABLE', frozenPlatformRate: 0.05 });
    });
    const w = await wallet();
    expect(w.debtBalance).toBe(0);
    expect(w.availableBalance).toBe(19_000 - 9_500);
  });

  it('leaves the wallet untouched when the consultant repaid Metwork outside the platform', async () => {
    await seedConsultantProgramSale();
    await db.update((d) => { d.mentorWallets![0]!.availableBalance = 0; });
    const r = await db.update((d) => reverseSaleInDraft(d, { mentorId: MENTOR, bookingId: 'bk-1', recoveredOffPlatform: true }));
    expect(r).toMatchObject({ ok: true, debtAdded: 0, recoveredOffPlatform: 9_500 });
    expect(await wallet()).toMatchObject({ availableBalance: 0 });
    expect((await wallet()).debtBalance ?? 0).toBe(0);
  });

  it('is idempotent', async () => {
    await seedConsultantProgramSale();
    await db.update((d) => reverseSaleInDraft(d, { mentorId: MENTOR, bookingId: 'bk-1' }));
    const again = await db.update((d) => reverseSaleInDraft(d, { mentorId: MENTOR, bookingId: 'bk-1' }));
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect((await wallet()).availableBalance).toBe(0);
    expect((await db.read()).mentorLedgerTxns!.filter((t) => t.type === 'REVERSAL')).toHaveLength(1);
  });
});

describe('guest refund of a consultant program (bank transfer)', () => {
  it('request → accept → account → paid, reversing the sale exactly once', async () => {
    await seedConsultantProgramSale();
    const req = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'Cannot attend', requestedBy: 'ADMIN', requestedById: ADMIN });
    if (!req.ok) throw new Error(req.reason);
    expect(req.request).toMatchObject({ status: 'REQUESTED', destination: 'BANK', amount: 10_000, ownerKind: 'MENTOR' });
    // Asking twice returns the same open request.
    const again = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'x', requestedBy: 'CLIENT' });
    expect(again.ok && again.replayed && again.request.id).toBe(req.request.id);

    const accepted = await acceptRefund({ id: req.request.id, adminId: ADMIN });
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(accepted.request.status).toBe('AWAITING_ACCOUNT');
    expect(accepted.request.reversal).toMatchObject({ ownerDebit: 9_500 });
    const booking = (await db.read()).bookings.find((b) => b.id === 'bk-1')!;
    expect(booking.status).toBe('REFUNDED');
    expect((await wallet()).availableBalance).toBe(0);

    // The emailed link carries the only copy of the token.
    const mail = sent.find((m) => m.kind === 'ACCOUNT_REQUEST')!;
    const token = String(mail.accountUrl).split('/').pop()!;
    expect(token.length).toBeGreaterThan(30);
    expect(JSON.stringify((await db.read()).refundRequests)).not.toContain(token);

    // A second accept replays without reversing again.
    const replay = await acceptRefund({ id: req.request.id, adminId: ADMIN });
    expect(replay.ok && replay.replayed).toBe(true);
    expect((await db.read()).mentorLedgerTxns!.filter((t) => t.type === 'REVERSAL')).toHaveLength(1);

    expect(await getAccountLinkView('not-a-real-token-not-a-real-token')).toEqual({ state: 'INVALID' });
    expect((await getAccountLinkView(token)).state).toBe('OPEN');

    expect(await submitRefundAccount(token, { accountType: 'ccp', accountNumber: '123', holderName: 'A B' })).toEqual({ ok: false, reason: 'INVALID_ACCOUNT_NUMBER' });
    expect(await submitRefundAccount(token, { accountType: 'ccp', accountNumber: '0012 3456 7890 1234 5678', holderName: 'Guest Client' })).toEqual({ ok: true });
    expect(sent.some((m) => m.kind === 'ACCOUNT_RECEIVED')).toBe(true);

    const paid = await markRefundPaid({ id: req.request.id, adminId: ADMIN, transferReference: 'VIR-1' });
    expect(paid.ok && paid.request.status).toBe('REFUNDED');
    expect(sent.some((m) => m.kind === 'TRANSFER_SENT')).toBe(true);
    // The link is dead once the money is sent.
    expect((await getAccountLinkView(token)).state).toBe('INVALID');

    // Nothing left to refund.
    const third = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'again', requestedBy: 'CLIENT' });
    expect(third).toEqual({ ok: false, reason: 'ALREADY_REFUNDED' });
  });

  it('a rejected request moves nothing', async () => {
    await seedConsultantProgramSale();
    const req = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'because', requestedBy: 'CLIENT' });
    if (!req.ok) throw new Error(req.reason);
    const rej = await rejectRefund({ id: req.request.id, adminId: ADMIN, reason: 'Outside the window' });
    expect(rej.ok && rej.request.status).toBe('REJECTED');
    expect((await wallet()).availableBalance).toBe(9_500);
    expect((await db.read()).bookings.find((b) => b.id === 'bk-1')!.status).toBe('CONFIRMED');
    // After a rejection a new request can be opened.
    const next = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'second try', requestedBy: 'CLIENT' });
    expect(next.ok && next.replayed).toBe(false);
  });

  it('refuses a guest with no email on file (no way to send the link)', async () => {
    await seedConsultantProgramSale({ clientEmail: null });
    const req = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'because', requestedBy: 'ADMIN' });
    if (!req.ok) throw new Error(req.reason);
    expect(await acceptRefund({ id: req.request.id, adminId: ADMIN })).toMatchObject({ ok: false, reason: 'NO_CLIENT_EMAIL' });
    expect((await wallet()).availableBalance).toBe(9_500); // refused before any write
  });

  it('refuses a booking nobody paid online', async () => {
    await seedConsultantProgramSale({ settledAt: null, status: 'PENDING_PAYMENT' });
    expect(await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', reason: 'x', requestedBy: 'ADMIN' })).toEqual({ ok: false, reason: 'NOTHING_PAID' });
  });
});

describe('registered client refund (wallet)', () => {
  it('credits the client wallet, reverses the incubator payout + commission, and emails', async () => {
    await db.update((d) => {
      const client = { id: 'client-1', role: 'ENTREPRENEUR', email: 'c@example.com', fullName: 'Client', status: 'ACTIVE', locale: 'fr' } as unknown as UserRecord;
      d.users.push(client, { id: ADMIN, role: 'ADMIN', email: 'a@example.com', fullName: 'Admin', status: 'ACTIVE' } as unknown as UserRecord);
      d.incubators.push({ id: 'inc-1', managerId: 'mgr-1', name: 'Incubator' } as unknown as IncubatorRecord);
      d.programs = [{ id: 'prog-1', incubatorId: 'inc-1' } as never];
      d.bookings.push(programBooking({ id: 'bk-2', userId: 'client-1', commissionAmount: 500 }));
      d.wallets.push({ id: 'w-mgr', userId: 'mgr-1', balance: 9_500, currency: 'DZD', status: 'ACTIVE', createdAt: now(), updatedAt: now() });
      const tx = (reference: string, type: TransactionRecord['type'], amount: number): TransactionRecord => ({
        id: reference, walletId: 'w-mgr', userId: 'mgr-1', type, amount, balanceAfter: 0, status: 'COMPLETED', description: '', reference,
        provider: 'internal', providerTxnId: null, metadata: {}, createdAt: now(), completedAt: now(),
      });
      d.transactions.push(tx('payout-bk-2', 'PAYOUT', 10_000), tx('commission-bk-2', 'COMMISSION', -500));
    });

    const req = await requestRefund({ sourceKind: 'BOOKING', sourceId: 'bk-2', reason: 'Cannot attend', requestedBy: 'CLIENT', requestedById: 'client-1' });
    if (!req.ok) throw new Error(req.reason);
    expect(req.request.destination).toBe('WALLET');

    const accepted = await acceptRefund({ id: req.request.id, adminId: ADMIN });
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(accepted.request).toMatchObject({ status: 'REFUNDED', destination: 'WALLET' });

    const d = await db.read();
    expect(d.wallets.find((w) => w.userId === 'client-1')!.balance).toBe(10_000);
    expect(d.wallets.find((w) => w.userId === 'mgr-1')!.balance).toBe(0); // −10 000 payout, +500 commission given back… and net 9 500 left their wallet
    expect(d.transactions.filter((t) => t.type === 'REFUND' && t.userId === 'client-1')).toHaveLength(1);
    expect(sent.find((m) => m.kind === 'WALLET_CREDITED')).toMatchObject({ to: 'c@example.com', amount: 10_000 });

    // Replays never credit twice.
    await acceptRefund({ id: req.request.id, adminId: ADMIN });
    expect((await db.read()).wallets.find((w) => w.userId === 'client-1')!.balance).toBe(10_000);
  });
});

describe('refund of a consultation', () => {
  it('cancels the session, reverses the held earning and credits a registered client', async () => {
    await db.update((d) => {
      d.users.push(
        { id: 'client-1', role: 'ENTREPRENEUR', email: 'c@example.com', fullName: 'Client', status: 'ACTIVE' } as unknown as UserRecord,
        { id: ADMIN, role: 'ADMIN', email: 'a@example.com', fullName: 'Admin', status: 'ACTIVE' } as unknown as UserRecord,
      );
      d.mentors = [{ id: MENTOR, fullName: 'Trainer' } as never];
      d.mentorBookings = [{
        id: 'mb-1', mentorId: MENTOR, userId: 'client-1', userName: 'Client', userEmail: 'c@example.com', userPhone: '', message: '',
        status: 'READY', adminNote: null, chargeType: 'PAID', amountCharged: 6_400, paymentStatus: 'PAID', instantBook: true,
        createdAt: now(), updatedAt: now(),
      } as unknown as MentorBookingRecord];
      applyMentorEarningToDraft(d, { mentorId: MENTOR, bookingId: 'mb-1', grossAmount: 6_400 });
    });
    expect((await wallet()).pendingBalance).toBe(5_120);

    const req = await requestRefund({ sourceKind: 'MENTOR_BOOKING', sourceId: 'mb-1', reason: 'Illness', requestedBy: 'CLIENT', requestedById: 'client-1' });
    if (!req.ok) throw new Error(req.reason);
    const accepted = await acceptRefund({ id: req.request.id, adminId: ADMIN });
    expect(accepted.ok && accepted.request.status).toBe('REFUNDED');

    const d = await db.read();
    expect(d.mentorBookings!.find((b) => b.id === 'mb-1')).toMatchObject({ status: 'CANCELLED', cancelledBy: 'admin' });
    expect((await wallet()).pendingBalance).toBe(0);
    expect(d.wallets.find((w) => w.userId === 'client-1')!.balance).toBe(6_400);
    expect(d.mentorBookings!.find((b) => b.id === 'mb-1')!.refundTransactionId).toBeTruthy();
  });
});

describe('consultation refund cutoff', () => {
  async function seedSession(startsInHours: number) {
    await db.update((d) => {
      d.users.push(
        { id: 'client-1', role: 'ENTREPRENEUR', email: 'c@example.com', fullName: 'Client', status: 'ACTIVE' } as unknown as UserRecord,
        { id: ADMIN, role: 'ADMIN', email: 'a@example.com', fullName: 'Admin', status: 'ACTIVE' } as unknown as UserRecord,
      );
      d.mentors = [{ id: MENTOR, fullName: 'Trainer' } as never];
      d.mentorBookings = [{
        id: 'mb-1', mentorId: MENTOR, userId: 'client-1', userName: 'Client', userEmail: 'c@example.com', userPhone: '', message: '',
        status: 'READY', adminNote: null, chargeType: 'PAID', amountCharged: 6_400, paymentStatus: 'PAID', instantBook: true,
        scheduledAt: new Date(Date.now() + startsInHours * 3_600_000).toISOString(),
        createdAt: now(), updatedAt: now(),
      } as unknown as MentorBookingRecord];
      applyMentorEarningToDraft(d, { mentorId: MENTOR, bookingId: 'mb-1', grossAmount: 6_400 });
    });
  }

  it('lets a client ask more than 24h ahead', async () => {
    await seedSession(48);
    const r = await requestRefund({ sourceKind: 'MENTOR_BOOKING', sourceId: 'mb-1', reason: 'x', requestedBy: 'CLIENT', requestedById: 'client-1' });
    expect(r.ok).toBe(true);
  });
  it('refuses a client inside 24h (same day) and writes nothing', async () => {
    await seedSession(5);
    const r = await requestRefund({ sourceKind: 'MENTOR_BOOKING', sourceId: 'mb-1', reason: 'x', requestedBy: 'CLIENT', requestedById: 'client-1' });
    expect(r).toEqual({ ok: false, reason: 'TOO_LATE' });
    expect((await db.read()).refundRequests ?? []).toHaveLength(0);
  });
  it('refuses a client after the session', async () => {
    await seedSession(-3);
    const r = await requestRefund({ sourceKind: 'MENTOR_BOOKING', sourceId: 'mb-1', reason: 'x', requestedBy: 'CLIENT', requestedById: 'client-1' });
    expect(r).toEqual({ ok: false, reason: 'TOO_LATE' });
  });
  it('still lets an admin open one inside the window (e.g. consultant no-show)', async () => {
    await seedSession(2);
    const r = await requestRefund({ sourceKind: 'MENTOR_BOOKING', sourceId: 'mb-1', reason: 'No-show', requestedBy: 'ADMIN', requestedById: ADMIN });
    expect(r.ok).toBe(true);
  });
});

describe('refund settled by hand before the engine existed', () => {
  it('reverses earning and fee, flags it paid by hand, and emails nobody', async () => {
    await seedConsultantProgramSale();
    await db.update((d) => { d.mentorWallets![0]!.availableBalance = 0; });
    const r = await recordOffPlatformRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', adminId: ADMIN, reason: 'Paid by hand', recoveredOffPlatform: true });
    if (!r.ok) throw new Error(r.reason);
    expect(r.request).toMatchObject({ status: 'REFUNDED', paidOffPlatform: true });
    expect((await wallet()).availableBalance).toBe(0);
    expect((await wallet()).debtBalance ?? 0).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await recordOffPlatformRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', adminId: ADMIN, reason: 'again', recoveredOffPlatform: true })).toEqual({ ok: false, reason: 'ALREADY_REFUNDED' });
  });
});

describe('incoming payments view', () => {
  it('shows a consultant card sale with its fee, and stops counting it once refunded', async () => {
    await seedConsultantProgramSale();
    await db.update((d) => { d.bookings[0]!.commissionAmount = 500; });
    let view = buildIncomingView(await db.read());
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ gross: 10_000, fee: 500, net: 9_500, channel: 'CARD', status: 'PAID', refundable: true, ownerKind: 'MENTOR', guest: true });
    expect(view.summary).toMatchObject({ collectedThisMonth: 10_000, commissionThisMonth: 500, owedToConsultants: 9_500 });

    await recordOffPlatformRefund({ sourceKind: 'BOOKING', sourceId: 'bk-1', adminId: ADMIN, reason: 'x', recoveredOffPlatform: false });
    view = buildIncomingView(await db.read());
    expect(view.rows[0]).toMatchObject({ status: 'REFUNDED', refundable: false });
    expect(view.summary).toMatchObject({ collectedThisMonth: 0, commissionThisMonth: 0 });
  });
});
