/**
 * The financial report of one program — what it brought in, what it cost,
 * and what is left.
 *
 * ONE computation, pure, over the store: the Finances tab, its exports and
 * any later summary all read this, so two screens can never disagree about a
 * program's profit.
 *
 * Money model — the same rules every other financial surface uses:
 *
 *  - A booking counts only if `bookingCountsAsRevenue` says so: cancelled,
 *    refunded and unpaid intents are not revenue.
 *  - BILLED is what participants owe the host, `totalAmount` — after any
 *    discount, before any fee. The payer fee a card buyer pays on top goes to
 *    the platform, never to the host, so it appears nowhere here.
 *  - COLLECTED is what actually reached the host: the online part (card or
 *    wallet), plus cash handed over — a desk deposit, and the balance once
 *    it is marked collected.
 *  - OUTSTANDING is cash still owed on site (payment status AWAITING_CASH).
 *  - The platform COMMISSION is `commissionAmount`, frozen on the booking at
 *    settlement by whichever engine paid the owner (incubator wallet or
 *    consultant ledger). It is taken on the online part only; cash carries
 *    none.
 *  - NET PROFIT = collected − commission − expenses. The PROJECTED profit
 *    adds what is still outstanding, for a program whose balances will come.
 *
 * All amounts are integer DZD, TTC — the platform records no VAT split.
 */
import { attendeeKey } from '@/server/attendance';
import { bookingCountsAsRevenue, bookingIsDeleted } from '@/server/bookings/status';
import type {
  BookingRecord,
  ExpenseRecord,
  ProgramRecord,
  RegistrationRecord,
} from '@/server/db/store';

export type PaymentChannel = 'CARD' | 'WALLET' | 'CASH' | 'OTHER';

export interface ProgramFinanceReport {
  programId: string;
  generatedAt: string;

  /* ── Revenue ── */
  billed: number;
  collected: number;
  outstanding: number;
  commission: number;
  /** Collected, less the platform commission — what the host keeps. */
  netRevenue: number;

  /* ── Costs ── */
  expensesTotal: number;
  expensesByCategory: Array<{ category: string | null; amount: number; count: number }>;

  /* ── Result ── */
  netProfit: number;
  /** If every outstanding balance is collected. */
  projectedProfit: number;
  /** Net profit over collected, 0–1 (can be negative). Null when nothing was collected. */
  margin: number | null;

  /* ── Participants ── */
  seatsTotal: number;
  /** Distinct people holding a seat — paid or free — deduped as attendance is. */
  participants: number;
  /** Participants with a booking that counts as revenue. */
  payingParticipants: number;
  freeParticipants: number;
  /** participants / seatsTotal, 0–1. Null when the program has no seat limit. */
  fillRate: number | null;
  /** Confirmed participants the host marked absent on the certificates page. */
  absent: number;

  /* ── Unit economics ── */
  /** Billed per paying participant. */
  averageTicket: number | null;
  /** Expenses per participant. */
  costPerParticipant: number | null;
  /**
   * Paying participants needed to cover the expenses at the current average
   * net ticket. Null when there is nothing to divide by.
   */
  breakEvenParticipants: number | null;

  /* ── Breakdown ── */
  byChannel: Array<{ channel: PaymentChannel; amount: number }>;
  /**
   * One point per day that saw a sign-up or money in, running totals included
   * — enough for the curve without the client re-deriving anything.
   */
  timeline: Array<{
    date: string;
    signups: number;
    cumulativeSignups: number;
    collected: number;
    cumulativeCollected: number;
  }>;
}

/** What the report reads — a `db.read()` result satisfies it. */
export interface FinanceData {
  bookings?: BookingRecord[] | null;
  registrations?: RegistrationRecord[] | null;
  expenses?: ExpenseRecord[] | null;
}

/** Algiers calendar day of an ISO timestamp — the day the host lived it. */
function algiersDay(iso: string): string {
  // Algeria is UTC+1 all year, no daylight saving.
  return new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 10);
}

interface BookingMoney {
  billed: number;
  online: number;
  cash: number;
  outstanding: number;
  commission: number;
  channel: PaymentChannel;
}

const nonNeg = (n: number | null | undefined) => Math.max(0, Math.round(n ?? 0));

/** How one booking's money splits. Exported for the tests that pin each shape. */
export function bookingMoney(b: BookingRecord): BookingMoney {
  const billed = nonNeg(b.totalAmount);
  const commission = nonNeg(b.commissionAmount);

  // Card and desk-deposit bookings carry the split explicitly.
  if (b.paymentMode) {
    const online = nonNeg(b.onlinePaidAmount);
    const remaining = nonNeg(b.cashRemainingAmount);
    const deskDeposit = nonNeg(b.cashDepositPaidAmount);
    const balanceCollected = b.paymentStatus === 'PAID' ? remaining : 0;
    const outstanding = b.paymentStatus === 'AWAITING_CASH' ? remaining : 0;
    return {
      billed,
      online,
      cash: deskDeposit + balanceCollected,
      outstanding,
      commission,
      channel: online > 0 ? 'CARD' : 'CASH',
    };
  }

  // Legacy shapes with no split: paid whole, one way.
  if (b.paymentMethod === 'wallet') {
    return { billed, online: billed, cash: 0, outstanding: 0, commission, channel: 'WALLET' };
  }
  if (b.paymentMethod === 'card') {
    return { billed, online: nonNeg(b.onlinePaidAmount ?? billed), cash: 0, outstanding: 0, commission, channel: 'CARD' };
  }
  if (b.paymentMethod === 'manual' || !b.paymentMethod) {
    // A plain manual booking is the host recording money taken offline.
    return { billed, online: 0, cash: billed, outstanding: 0, commission, channel: 'CASH' };
  }
  return { billed, online: 0, cash: billed, outstanding: 0, commission, channel: 'OTHER' };
}

export function computeProgramFinance(
  data: FinanceData,
  program: Pick<ProgramRecord, 'id' | 'seatsTotal'>,
  now: Date = new Date(),
): ProgramFinanceReport {
  const bookings = (data.bookings ?? []).filter(
    (b) => b.itemKind === 'PROGRAM' && b.itemId === program.id && !bookingIsDeleted(b),
  );
  const revenueBookings = bookings.filter(bookingCountsAsRevenue);
  const registrations = (data.registrations ?? []).filter(
    (r) => r.entityType === 'PROGRAM' && r.entityId === program.id && r.status === 'CONFIRMED',
  );
  const expenses = (data.expenses ?? []).filter((e) => e.programId === program.id);

  /* ── Money ── */
  let billed = 0, online = 0, cash = 0, outstanding = 0, commission = 0;
  const channels = new Map<PaymentChannel, number>();
  const collectedByDay = new Map<string, number>();

  for (const b of revenueBookings) {
    const m = bookingMoney(b);
    billed += m.billed;
    online += m.online;
    cash += m.cash;
    outstanding += m.outstanding;
    commission += m.commission;
    const got = m.online + m.cash;
    if (got > 0) {
      channels.set(m.channel, (channels.get(m.channel) ?? 0) + got);
      // Dated when the money settled, else when the booking was made.
      const day = algiersDay(b.cashCollectedAt ?? b.settledAt ?? b.createdAt);
      collectedByDay.set(day, (collectedByDay.get(day) ?? 0) + got);
    }
  }

  const collected = online + cash;
  const netRevenue = collected - commission;

  /* ── Costs ── */
  const expensesTotal = expenses.reduce((s, e) => s + nonNeg(e.amount), 0);
  const byCategory = new Map<string | null, { amount: number; count: number }>();
  for (const e of expenses) {
    const key = e.category?.trim() || null;
    const row = byCategory.get(key) ?? { amount: 0, count: 0 };
    row.amount += nonNeg(e.amount);
    row.count += 1;
    byCategory.set(key, row);
  }

  /* ── Participants — deduped exactly like attendance ── */
  const seats = new Map<string, string>(); // key → first sign-up timestamp
  const paying = new Set<string>();
  for (const b of revenueBookings) {
    const key = attendeeKey(b.userId, b.clientEmail, b.id);
    paying.add(key);
    const at = seats.get(key);
    if (!at || b.createdAt < at) seats.set(key, b.createdAt);
  }
  for (const r of registrations) {
    const key = attendeeKey(r.userId, r.email, r.id);
    // A paid registration is materialised from its booking; same person.
    const booking = r.bookingId ? revenueBookings.find((b) => b.id === r.bookingId) : undefined;
    const k = booking ? attendeeKey(booking.userId, booking.clientEmail, booking.id) : key;
    const at = seats.get(k);
    if (!at || r.createdAt < at) seats.set(k, r.createdAt);
  }
  const participants = seats.size;
  const payingParticipants = paying.size;
  const absent = registrations.filter((r) => r.absent).length;

  /* ── Timeline ── */
  const signupsByDay = new Map<string, number>();
  for (const at of seats.values()) {
    const day = algiersDay(at);
    signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1);
  }
  const days = [...new Set([...signupsByDay.keys(), ...collectedByDay.keys()])].sort();
  let cumulativeSignups = 0, cumulativeCollected = 0;
  const timeline = days.map((date) => {
    const signups = signupsByDay.get(date) ?? 0;
    const got = collectedByDay.get(date) ?? 0;
    cumulativeSignups += signups;
    cumulativeCollected += got;
    return { date, signups, cumulativeSignups, collected: got, cumulativeCollected };
  });

  /* ── Result & unit economics ── */
  const netProfit = netRevenue - expensesTotal;
  const averageTicket = payingParticipants > 0 ? Math.round(billed / payingParticipants) : null;
  // Net per paying participant if all of them pay their balance: what one
  // more paying participant is worth to the host.
  const netPerTicket = payingParticipants > 0 ? (billed - commission) / payingParticipants : 0;
  const breakEvenParticipants = expensesTotal > 0 && netPerTicket > 0
    ? Math.ceil(expensesTotal / netPerTicket)
    : expensesTotal === 0 ? 0 : null;

  const seatsTotal = Math.max(0, program.seatsTotal ?? 0);

  return {
    programId: program.id,
    generatedAt: now.toISOString(),
    billed,
    collected,
    outstanding,
    commission,
    netRevenue,
    expensesTotal,
    expensesByCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    netProfit,
    projectedProfit: netProfit + outstanding,
    margin: collected > 0 ? netProfit / collected : null,
    seatsTotal,
    participants,
    payingParticipants,
    freeParticipants: Math.max(0, participants - payingParticipants),
    fillRate: seatsTotal > 0 ? participants / seatsTotal : null,
    absent,
    averageTicket,
    costPerParticipant: participants > 0 ? Math.round(expensesTotal / participants) : null,
    breakEvenParticipants,
    byChannel: (['CARD', 'WALLET', 'CASH', 'OTHER'] as const)
      .filter((c) => (channels.get(c) ?? 0) > 0)
      .map((channel) => ({ channel, amount: channels.get(channel)! })),
    timeline,
  };
}
