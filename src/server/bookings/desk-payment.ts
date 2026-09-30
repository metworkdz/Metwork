/**
 * The price of a desk booking, and how much of it has been paid — read and
 * corrected in ONE place.
 *
 * Two screens edit the same money: the participant dialog on a program's
 * registrations, and the booking dialog in Réservations. Both call this, so
 * the booking row, the balance due, the « Espèces encaissées » badge and the
 * program's finance report can never disagree.
 *
 * Only a `manual` booking — money handed over off-platform — can be corrected.
 * A card or wallet payment moved real money through the platform, with a
 * commission and a payout; its amounts are frozen, and a refund goes through
 * the booking cancel flow.
 *
 * How the amounts are written:
 *  - paid in full, on a plain manual booking → left plain (the legacy shape,
 *    which every reader already treats as paid whole);
 *  - otherwise the desk-deposit shape: `paymentMode: 'CASH_DEPOSIT'`, what is
 *    in hand in `cashDepositPaidAmount`, the rest in `cashRemainingAmount`,
 *    and `paymentStatus` PAID once nothing is left, else AWAITING_CASH.
 *
 * No wallet, transaction or commission is touched: none exists on a manual
 * booking.
 */
import type { BookingRecord } from '@/server/db/store';
import { bookingMoney } from '@/server/program-finance/report';

/** Upper bound on an amount typed by a host — catches a slipped key. */
export const MAX_DESK_AMOUNT = 100_000_000;

export interface DeskPayment {
  total: number;
  paid: number;
  /** False on an online payment, and on a booking that is not confirmed. */
  editable: boolean;
}

/**
 * Confirmed (or completed) only: a cancelled booking's money is settled, and a
 * public cash reservation still PENDING_PAYMENT is confirmed first — editing
 * its amounts would mark money received on a booking nobody has accepted.
 */
function isEditable(b: BookingRecord): boolean {
  return (
    b.paymentMethod === 'manual' &&
    (b.onlinePaidAmount ?? 0) === 0 &&
    (b.status === 'CONFIRMED' || b.status === 'COMPLETED')
  );
}

/** What the booking costs and what has been paid on it, for display. */
export function deskPaymentOf(b: BookingRecord): DeskPayment {
  const m = bookingMoney(b);
  return {
    total: m.billed,
    paid: Math.min(m.billed, m.online + m.cash),
    editable: isEditable(b),
  };
}

export type DeskPaymentPlan =
  | { ok: true; total: number; paid: number; changed: boolean }
  | { ok: false; reason: 'NOT_EDITABLE' | 'INVALID_AMOUNT' | 'PAID_EXCEEDS_TOTAL' };

/**
 * Check a correction without writing anything. Callers run this BEFORE their
 * first mutation: the store saves the draft whatever the mutator returns.
 *
 * `paidAmount` omitted keeps what was paid — except on a booking paid in full,
 * where a new price stays paid in full (the host changed the price, not what
 * the client handed over as a whole).
 */
export function planDeskPayment(
  b: BookingRecord,
  patch: { totalAmount?: number; paidAmount?: number },
): DeskPaymentPlan {
  if (!isEditable(b)) return { ok: false, reason: 'NOT_EDITABLE' };
  const current = deskPaymentOf(b);
  const total = Math.round(patch.totalAmount ?? current.total);
  const paidInFull = current.paid >= current.total;
  const paid = Math.round(patch.paidAmount ?? (paidInFull ? total : current.paid));
  if (total < 0 || paid < 0 || total > MAX_DESK_AMOUNT) return { ok: false, reason: 'INVALID_AMOUNT' };
  if (paid > total) return { ok: false, reason: 'PAID_EXCEEDS_TOTAL' };
  return { ok: true, total, paid, changed: total !== current.total || paid !== current.paid };
}

/** Write a plan made by `planDeskPayment` onto the (draft) booking. */
export function applyDeskPayment(
  b: BookingRecord,
  plan: Extract<DeskPaymentPlan, { ok: true }>,
  actorId: string,
  now: string,
): void {
  if (!plan.changed) return;
  const before = deskPaymentOf(b);
  const { total, paid } = plan;

  b.totalAmount = total;
  if (paid === total && b.paymentMode !== 'CASH_DEPOSIT') {
    // Plain manual booking, still paid whole: nothing else to say.
  } else {
    const remaining = total - paid;
    b.paymentMode = 'CASH_DEPOSIT';
    b.onlinePaidAmount = 0;
    if (paid > 0) b.cashDepositPaidAmount = paid;
    else delete b.cashDepositPaidAmount;
    b.cashRemainingAmount = remaining;
    if (remaining === 0) {
      b.paymentStatus = 'PAID';
      b.cashCollectedAt = b.cashCollectedAt ?? now;
      b.cashCollectedBy = b.cashCollectedBy ?? actorId;
    } else {
      b.paymentStatus = 'AWAITING_CASH';
      b.cashCollectedAt = null;
      b.cashCollectedBy = null;
    }
  }

  b.paymentEdits = [
    ...(b.paymentEdits ?? []),
    { at: now, by: actorId, from: { total: before.total, paid: before.paid }, to: { total, paid } },
  ];
  b.updatedAt = now;
}
