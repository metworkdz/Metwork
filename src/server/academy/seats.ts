/**
 * Incubator Academy Pass seats.
 *
 * Owner decisions (2026-11-02): the incubator pays from its wallet (the
 * manager's wallet), cheaper per seat in bulk (tiers in Academy settings); the
 * mentors' share stays on the FULL Pass price — Metwork absorbs the discount.
 *
 * A batch is `seats` seats for `months` months from the purchase. The manager
 * assigns each seat to a member (an entrepreneur or freelancer account, by
 * email or phone) and may reassign it. Each month, the seat's holder at that
 * time gets a one-month Pass term (method SEAT): access, watch-time settlement
 * and analytics are the Pass's own. A month already granted stays with the
 * member who had it; reassigning changes the months still to come.
 */
import { randomUUID } from 'node:crypto';
import { db, type AcademySeatBatchRecord, type UserRecord } from '@/server/db/store';
import { computePeriodEnd } from '@/lib/billing-cycles';
import { ACADEMY_MAX_SEAT_MONTHS, ACADEMY_MAX_SEATS, canBuyAcademy, quoteSeats, type SeatQuote } from '@/lib/academy';
import { debitWalletInDraft } from '@/server/wallet/service';
import { createNotification } from '@/server/notifications/create-notification';
import { getAcademySettings, seatTiersOf } from './settings';
import { grantSeatTermInDraft } from './pass-core';

type StoreData = Awaited<ReturnType<typeof db.read>>;
type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

/** The incubator this manager runs, if any. */
export function incubatorOfManager(d: Pick<StoreData, 'incubators'>, userId: string) {
  return (d.incubators ?? []).find((i) => i.managerId === userId) ?? null;
}

export async function quoteSeatPurchase(seats: number, months: number): Promise<SeatQuote & { tiers: { minSeats: number; discountRate: number }[] }> {
  const s = await getAcademySettings();
  const tiers = seatTiersOf(s);
  return { ...quoteSeats(seats, months, s.passMonthlyPriceDzd, tiers), tiers };
}

/** [start, end) of month `i` of a batch. */
export function seatMonthWindow(batch: Pick<AcademySeatBatchRecord, 'startAt'>, i: number): { start: string; end: string } {
  let start = batch.startAt;
  for (let k = 0; k < i; k++) start = computePeriodEnd(start, 'MONTHLY');
  return { start, end: computePeriodEnd(start, 'MONTHLY') };
}

/** The month index covering `now`, or null outside the batch. */
export function currentSeatMonth(batch: Pick<AcademySeatBatchRecord, 'startAt' | 'months'>, now = new Date()): number | null {
  const t = now.toISOString();
  if (t < batch.startAt) return null;
  for (let i = 0; i < batch.months; i++) {
    const w = seatMonthWindow(batch, i);
    if (t >= w.start && t < w.end) return i;
  }
  return null;
}

/** Give the seat's holder month `i`, if it is not granted yet. Inside an open update. */
function grantMonthInDraft(d: StoreDraft, batch: AcademySeatBatchRecord, seatId: string, i: number, now: Date): boolean {
  const seat = batch.seatList.find((x) => x.id === seatId);
  if (!seat?.holderUserId || i < 0 || i >= batch.months || seat.grantedMonths.includes(i)) return false;
  // A holder who deleted their account gets nothing more; the manager can give the seat to someone else.
  if (!d.users.some((u) => u.id === seat.holderUserId)) return false;
  const w = seatMonthWindow(batch, i);
  const nowIso = now.toISOString();
  grantSeatTermInDraft(d, {
    userId: seat.holderUserId,
    start: nowIso > w.start ? nowIso : w.start,
    end: w.end,
    listPriceDzd: batch.unitListPriceDzd,
    amountDzd: batch.unitPriceDzd,
    paymentRef: `academy-seat-${seat.id}-${i}`,
    now: nowIso,
  });
  seat.grantedMonths.push(i);
  return true;
}

function grantCurrentMonthInDraft(d: StoreDraft, batch: AcademySeatBatchRecord, seatId: string, now: Date): boolean {
  const i = currentSeatMonth(batch, now);
  return i !== null && grantMonthInDraft(d, batch, seatId, i, now);
}

/** The cron runs once a day: a month starting within this window is granted ahead, so access never lapses. */
const AHEAD_MS = 26 * 3600 * 1000;

export type BuySeatsResult =
  | { ok: true; batch: AcademySeatBatchRecord }
  | { ok: false; code: 'NOT_AN_INCUBATOR' | 'INVALID_QUANTITY' | 'WALLET_FROZEN' }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

/** Buy seats from the manager's wallet: debit and create the batch in ONE write. Idempotent on `clientReference`. */
export async function buySeats(managerId: string, input: { seats: number; months: number; clientReference: string }): Promise<BuySeatsResult> {
  const { seats, months } = input;
  if (!Number.isInteger(seats) || seats < 1 || seats > ACADEMY_MAX_SEATS || !Number.isInteger(months) || months < 1 || months > ACADEMY_MAX_SEAT_MONTHS) {
    return { ok: false, code: 'INVALID_QUANTITY' };
  }
  const d0 = await db.read();
  const incubator = incubatorOfManager(d0, managerId);
  if (!incubator) return { ok: false, code: 'NOT_AN_INCUBATOR' };
  const replay = (d0.academySeatBatches ?? []).find((b) => b.paidBy === managerId && b.clientReference === input.clientReference);
  if (replay) return { ok: true, batch: replay };
  const quote = await quoteSeatPurchase(seats, months);

  return db.update((d) => {
    const again = (d.academySeatBatches ?? []).find((b) => b.paidBy === managerId && b.clientReference === input.clientReference);
    if (again) return { ok: true as const, batch: again };
    const id = randomUUID();
    const debit = debitWalletInDraft(d, {
      userId: managerId,
      amount: quote.amountDzd,
      description: `Startup Academy — ${seats} place(s) Pass × ${months} mois`,
      reference: `academy-seats-${id}`,
      metadata: { batchId: id, seats, months, unitPriceDzd: quote.unitPriceDzd, discountRate: quote.discountRate },
    });
    if (!debit.ok) return debit.reason === 'INSUFFICIENT_FUNDS'
      ? { ok: false as const, code: 'INSUFFICIENT_FUNDS' as const, balance: debit.balance, required: debit.required }
      : { ok: false as const, code: 'WALLET_FROZEN' as const };
    const now = new Date().toISOString();
    const batch: AcademySeatBatchRecord = {
      id,
      incubatorId: incubator.id,
      paidBy: managerId,
      seats,
      months,
      startAt: now,
      unitListPriceDzd: quote.unitListPriceDzd,
      unitPriceDzd: quote.unitPriceDzd,
      discountRate: quote.discountRate,
      amountDzd: quote.amountDzd,
      paymentRef: `academy-seats-${id}`,
      clientReference: input.clientReference,
      seatList: Array.from({ length: seats }, () => ({ id: randomUUID(), holderUserId: null, grantedMonths: [] })),
      createdAt: now,
    };
    if (!Array.isArray(d.academySeatBatches)) d.academySeatBatches = [];
    d.academySeatBatches.push(batch);
    return { ok: true as const, batch };
  });
}

/** Algerian number without country code or leading zeros: "+213 0555…", "0555…" and "555…" all match. */
export function nationalDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^213/, '').replace(/^0+/, '');
}

/** Find a member account by email or phone (digits compared, so spaces and +213 / 0 prefixes match). */
export function findMemberByContact(users: UserRecord[], contact: string): UserRecord | null {
  const c = contact.trim().toLowerCase();
  if (c.includes('@')) return users.find((u) => u.email?.toLowerCase() === c) ?? null;
  const digits = nationalDigits(c);
  if (digits.length < 8) return null;
  return users.find((u) => nationalDigits(u.phone) === digits) ?? null;
}

export type AssignSeatResult =
  | { ok: true; holderName: string }
  | { ok: false; code: 'NOT_FOUND' | 'MEMBER_NOT_FOUND' | 'NOT_A_LEARNER' | 'ALREADY_SEATED' | 'ENDED' };

/**
 * Give a seat to a member (or free it with `contact: null`). The member gets
 * the current month at once; a month already granted to the previous holder
 * stays theirs.
 */
export async function assignSeat(managerId: string, batchId: string, seatId: string, contact: string | null, now = new Date()): Promise<AssignSeatResult> {
  const d0 = await db.read();
  const member = contact ? findMemberByContact(d0.users, contact) : null;
  if (contact && !member) return { ok: false, code: 'MEMBER_NOT_FOUND' };
  if (member && !canBuyAcademy(member.role)) return { ok: false, code: 'NOT_A_LEARNER' };

  const res = await db.update((d) => {
    const incubator = incubatorOfManager(d, managerId);
    const batch = d.academySeatBatches?.find((b) => b.id === batchId && b.incubatorId === incubator?.id);
    const seat = batch?.seatList.find((x) => x.id === seatId);
    if (!batch || !seat) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (currentSeatMonth(batch, now) === null && now.toISOString() >= batch.startAt) return { ok: false as const, code: 'ENDED' as const };
    if (member && batch.seatList.some((x) => x.id !== seatId && x.holderUserId === member.id)) return { ok: false as const, code: 'ALREADY_SEATED' as const };
    seat.holderUserId = member?.id ?? null;
    seat.holderContact = member ? contact!.trim().slice(0, 120) : null;
    const granted = member ? grantCurrentMonthInDraft(d, batch, seat.id, now) : false;
    return { ok: true as const, holderName: member?.fullName ?? '', granted, incubatorName: incubator?.name ?? '' };
  });
  if (res.ok && member && res.granted) {
    await createNotification({
      userId: member.id,
      type: 'ACADEMY_PASS',
      title: 'Academy Pass offert par votre incubateur',
      body: `${res.incubatorName} vous a attribué une place : tous les cours du Pass sont ouverts.`,
      href: '/academy/courses',
    });
  }
  return res.ok ? { ok: true, holderName: res.holderName } : res;
}

/** Daily (with the Pass cron): each seat's holder gets the month that has just begun. Idempotent. */
export async function grantDueSeatMonths(now = new Date()): Promise<{ granted: number }> {
  return db.update((d) => {
    let granted = 0;
    for (const batch of d.academySeatBatches ?? []) {
      const i = currentSeatMonth(batch, now);
      for (const seat of batch.seatList) {
        if (grantCurrentMonthInDraft(d, batch, seat.id, now)) granted++;
        if (i !== null && i + 1 < batch.months && Date.parse(seatMonthWindow(batch, i + 1).start) - now.getTime() <= AHEAD_MS
          && grantMonthInDraft(d, batch, seat.id, i + 1, now)) granted++;
      }
    }
    return { granted };
  });
}

export interface SeatBatchView {
  id: string;
  seats: number;
  months: number;
  startAt: string;
  endAt: string;
  unitPriceDzd: number;
  discountRate: number;
  amountDzd: number;
  currentMonth: number | null;
  seatList: { id: string; holder: { name: string; contact: string } | null }[];
}

/** The incubator's batches, newest first, with who holds each seat. */
export async function listSeatBatches(managerId: string, now = new Date()): Promise<SeatBatchView[] | null> {
  const d = await db.read();
  const incubator = incubatorOfManager(d, managerId);
  if (!incubator) return null;
  return (d.academySeatBatches ?? [])
    .filter((b) => b.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => ({
      id: b.id,
      seats: b.seats,
      months: b.months,
      startAt: b.startAt,
      endAt: seatMonthWindow(b, b.months - 1).end,
      unitPriceDzd: b.unitPriceDzd,
      discountRate: b.discountRate,
      amountDzd: b.amountDzd,
      currentMonth: currentSeatMonth(b, now),
      seatList: b.seatList.map((s) => {
        const u = s.holderUserId ? d.users.find((x) => x.id === s.holderUserId) : null;
        return { id: s.id, holder: u ? { name: u.fullName, contact: s.holderContact ?? '' } : null };
      }),
    }));
}
