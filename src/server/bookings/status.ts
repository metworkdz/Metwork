/**
 * Single source of truth for "what does a booking status MEAN" — shared by every
 * analytics, seat-hold and guest-checkout surface so the rules can never diverge.
 *
 * Pure & dependency-light (it only duck-types `{ status }` / takes a kind), so it
 * is safe to import from server routes, the attendance/availability engine, AND
 * client components.
 *
 * The seat-hold rule and the revenue rule are intentionally the SAME exclusion
 * set: a booking that is CANCELLED, REFUNDED, or still awaiting payment
 * (PENDING_PAYMENT) holds no seat and counts toward no financial figure. Only
 * once it settles (CONFIRMED / COMPLETED) or is a paid/escrowed wallet booking
 * (PENDING) does it occupy capacity and count as revenue.
 */
import type { BookingItemKind, BookingStatus } from '@/server/db/store';

/** Minimal shape the status predicates need (works on full records or DTOs). */
type HasStatus = { status: BookingStatus };

/**
 * A PENDING_PAYMENT booking is an unpaid intent (card-deposit / cash-reserve).
 * It holds no seat and is excluded from every financial figure until it settles.
 */
export function isAwaitingPayment(b: HasStatus): boolean {
  return b.status === 'PENDING_PAYMENT';
}

/**
 * Does this booking count toward seats taken AND toward financial figures?
 *
 * Excludes the three "no value yet / no value anymore" states:
 *   - CANCELLED / REFUNDED — gone.
 *   - PENDING_PAYMENT      — awaiting payment, holds nothing.
 *
 * Mirrors the long-standing inline checks in `attendance.ts` and
 * `availability.ts`; centralised here so analytics can't drift from seat-hold.
 */
export function bookingCountsAsRevenue(b: HasStatus): boolean {
  return (
    b.status !== 'CANCELLED' &&
    b.status !== 'REFUNDED' &&
    b.status !== 'PENDING_PAYMENT'
  );
}

/** Alias: the seat-hold rule is identical to the revenue rule. */
export const bookingHoldsSeat = bookingCountsAsRevenue;

/**
 * Public guest checkout (no Metwork account) is allowed ONLY for programs.
 * Spaces, events and consultations require a Metwork account and must pass
 * through Metwork payments. The route layer is the authoritative enforcement
 * point; this predicate keeps the rule in one testable place.
 */
export function guestCheckoutAllowedFor(kind: BookingItemKind): boolean {
  return kind === 'PROGRAM';
}
