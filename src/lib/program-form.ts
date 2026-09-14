/**
 * THE definition of a program form — shared by the incubator dashboard and the
 * consultant portal.
 *
 * The two surfaces look nothing alike (one is the platform dashboard, the other
 * a separately-styled portal with its own palette and its own auth), so they
 * keep their own markup. Everything that decides what a program IS lives here:
 * the field set, the defaults, how an existing record loads back into the form,
 * what counts as valid, and the exact body sent to the API.
 *
 * That split matters because the two had already drifted, in ways nobody would
 * find by reading either file alone:
 *
 *   • The portal never sent `onlinePrice` / `cashPrice`. Consultants could not
 *     charge a different price for cash, although the API had always accepted
 *     it — the field simply was not on the form.
 *
 *   • The incubator form never checked date ORDER. Its route does not either
 *     (the consultant's does, via a `.refine`), so an incubator could publish a
 *     program whose application deadline fell after its start date, and the
 *     public page would show it as closed the moment it appeared.
 *
 *   • The portal anchored dates at MIDNIGHT local. In Algeria (UTC+1) that is
 *     23:00 the previous day in UTC, so every consultant program was stored one
 *     day early and rendered one day early. Dates anchor at noon here, which is
 *     what the incubator form always did and what `applyClockTime` expects when
 *     a published start time replaces the anchor.
 *
 * Deliberately dependency-free — no React, no next-intl, no server imports — so
 * both client surfaces and the tests can import it without dragging anything
 * else in. Error cases come back as KEYS, and each surface renders them through
 * its own translator.
 */
import { CLOCK_TIME_PATTERN } from '@/lib/booking-when';
import type { ProgramType } from '@/types/domain';

export type PaymentMethod = 'ONLINE' | 'CASH';
export type CashDepositType = 'FIXED' | 'PERCENT';

export const PROGRAM_TYPES: ProgramType[] = [
  'INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP', 'WEBINAR',
];

/**
 * Form state. Numeric and date fields stay STRINGS because that is what an
 * `<input>` holds, and because "" has to stay distinguishable from 0 — an empty
 * cash price means "same as the base price", while 0 means "free".
 */
export interface ProgramFormValues {
  title: string;
  description: string;
  type: ProgramType;
  city: string;
  imageUrls: string[];
  price: string;
  /** Blank ⇒ falls back to `price`. */
  onlinePrice: string;
  /** Blank ⇒ falls back to `price`. */
  cashPrice: string;
  seatsTotal: string;
  /** "YYYY-MM-DD" from a date input. */
  deadline: string;
  startDate: string;
  /** "HH:MM" from a time input, or "" for no published time. */
  startTime: string;
  endTime: string;
  endDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  cashDepositType: CashDepositType;
  /** Blank or "0" ⇒ no deposit; the whole amount is collected on site. */
  cashDepositValue: string;
}

export function emptyProgramForm(): ProgramFormValues {
  return {
    title: '',
    description: '',
    type: 'TRAINING',
    city: '',
    imageUrls: [],
    price: '0',
    onlinePrice: '',
    cashPrice: '',
    seatsTotal: '20',
    deadline: '',
    startDate: '',
    startTime: '',
    endTime: '',
    endDate: '',
    acceptedPaymentMethods: ['ONLINE', 'CASH'],
    cashDepositType: 'PERCENT',
    cashDepositValue: '10',
  };
}

/** The subset of a stored program the form needs to load itself back. */
export interface ProgramFormSource {
  title?: string | null;
  description?: string | null;
  type?: ProgramType | null;
  city?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  price?: number | null;
  onlinePrice?: number | null;
  cashPrice?: number | null;
  seatsTotal?: number | null;
  deadline?: string | null;
  startDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  endDate?: string | null;
  acceptedPaymentMethods?: PaymentMethod[] | null;
  cashDepositType?: CashDepositType | null;
  cashDepositValue?: number | null;
}

/** An ISO datetime back to the "YYYY-MM-DD" a date input wants. */
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  // Dates are stored anchored at noon precisely so slicing the UTC date here
  // yields the day the host picked, in every Algerian timezone offset.
  return iso.slice(0, 10);
}

export function programFormFromRecord(source: ProgramFormSource): ProgramFormValues {
  const base = emptyProgramForm();
  return {
    title: source.title ?? '',
    description: source.description ?? '',
    type: source.type ?? base.type,
    city: source.city ?? '',
    imageUrls: source.imageUrls?.length
      ? source.imageUrls
      : (source.imageUrl ? [source.imageUrl] : []),
    price: source.price != null ? String(source.price) : '0',
    onlinePrice: source.onlinePrice != null ? String(source.onlinePrice) : '',
    cashPrice: source.cashPrice != null ? String(source.cashPrice) : '',
    seatsTotal: source.seatsTotal != null ? String(source.seatsTotal) : base.seatsTotal,
    deadline: isoToDateInput(source.deadline),
    startDate: isoToDateInput(source.startDate),
    startTime: source.startTime ?? '',
    endTime: source.endTime ?? '',
    endDate: isoToDateInput(source.endDate),
    acceptedPaymentMethods: source.acceptedPaymentMethods?.length
      ? source.acceptedPaymentMethods
      : base.acceptedPaymentMethods,
    cashDepositType: source.cashDepositType ?? base.cashDepositType,
    // A stored program with no deposit comes back as an explicit 0 rather than
    // the 10% default, or reopening the form would silently re-add a deposit
    // the host had deliberately removed.
    cashDepositValue: source.cashDepositValue != null
      ? String(source.cashDepositValue)
      : (source.cashDepositType ? base.cashDepositValue : '0'),
  };
}

/**
 * Toggle a payment method, refusing to leave the list empty — a program that
 * accepts no payment method at all cannot be sold through any surface.
 */
export function togglePaymentMethod(
  current: PaymentMethod[],
  method: PaymentMethod,
): PaymentMethod[] {
  if (!current.includes(method)) return [...current, method];
  const next = current.filter((m) => m !== method);
  return next.length === 0 ? current : next;
}

/* ─────────────────────────────── Validation ─────────────────────────────── */

export type ProgramFormError =
  | 'title'
  | 'description'
  | 'city'
  | 'seats'
  | 'price'
  | 'dates'
  | 'dateOrder'
  | 'clockTime'
  | 'depositPercent'
  | 'depositNegative';

/**
 * The first problem with this form, or null when it is ready to send.
 *
 * Runs on BOTH surfaces, so a rule added here reaches the dashboard and the
 * portal at once. Mirrors the server's own checks rather than replacing them:
 * the API re-validates everything, and this exists so the host is told before
 * the round trip rather than after it.
 */
export function validateProgramForm(v: ProgramFormValues): ProgramFormError | null {
  if (v.title.trim().length < 2) return 'title';
  if (v.description.trim().length < 10) return 'description';
  if (!v.city.trim()) return 'city';

  const seats = Number(v.seatsTotal);
  if (!Number.isFinite(seats) || seats < 1) return 'seats';

  for (const amount of [v.price, v.onlinePrice, v.cashPrice]) {
    if (amount.trim() === '') continue;
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return 'price';
  }

  if (!v.deadline || !v.startDate || !v.endDate) return 'dates';
  // Applications must close no later than the day the program starts, and a
  // program must end after it begins. The incubator surface never checked this
  // and neither does its route, so this is the only thing standing between a
  // host and a program that is closed on the day it is published.
  if (!(v.deadline <= v.startDate && v.startDate < v.endDate)) return 'dateOrder';

  for (const time of [v.startTime, v.endTime]) {
    if (time.trim() === '') continue;
    if (!CLOCK_TIME_PATTERN.test(time)) return 'clockTime';
  }

  if (v.acceptedPaymentMethods.includes('CASH') && v.cashDepositValue.trim() !== '') {
    const deposit = Number(v.cashDepositValue);
    if (!Number.isFinite(deposit) || deposit < 0) return 'depositNegative';
    if (v.cashDepositType === 'PERCENT' && deposit > 100) return 'depositPercent';
  }

  return null;
}

/* ──────────────────────────────── Payload ───────────────────────────────── */

export interface ProgramPayload {
  title: string;
  description: string;
  type: ProgramType;
  city: string;
  imageUrls: string[];
  price: number;
  onlinePrice: number | null;
  cashPrice: number | null;
  seatsTotal: number;
  deadline: string;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  endDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  cashDepositType: CashDepositType | null;
  cashDepositValue: number | null;
}

/**
 * A date input's value as an ISO datetime, anchored at NOON local.
 *
 * Noon, not midnight: Algeria is UTC+1, so midnight local is 23:00 the previous
 * day in UTC and the stored date is a day early. Noon survives every offset the
 * platform sees, and it is the anchor `applyClockTime` replaces when a program
 * publishes a real start time.
 */
export function dateInputToIso(dateLocal: string): string {
  return new Date(`${dateLocal}T12:00:00`).toISOString();
}

/** The exact body both surfaces POST and PATCH. */
export function programFormToPayload(v: ProgramFormValues): ProgramPayload {
  const acceptsCash = v.acceptedPaymentMethods.includes('CASH');
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    type: v.type,
    city: v.city.trim(),
    imageUrls: v.imageUrls,
    price: Number(v.price) || 0,
    // Blank means "no separate rate" — the resolver falls back to `price`.
    onlinePrice: v.onlinePrice.trim() === '' ? null : Number(v.onlinePrice),
    cashPrice: v.cashPrice.trim() === '' ? null : Number(v.cashPrice),
    seatsTotal: Number(v.seatsTotal),
    deadline: dateInputToIso(v.deadline),
    startDate: dateInputToIso(v.startDate),
    // Blank ⇒ the program publishes no start time, which is how every program
    // behaved before the field existed.
    startTime: v.startTime.trim() === '' ? null : v.startTime,
    endTime: v.endTime.trim() === '' ? null : v.endTime,
    endDate: dateInputToIso(v.endDate),
    acceptedPaymentMethods: v.acceptedPaymentMethods,
    // The deposit only means anything when cash is accepted. Blank or 0 is a
    // real answer — "pay the whole thing on the day" — and the server stores
    // it as no deposit at all.
    cashDepositType: acceptsCash ? v.cashDepositType : null,
    cashDepositValue: acceptsCash
      ? (v.cashDepositValue.trim() === '' ? 0 : Number(v.cashDepositValue))
      : null,
  };
}
