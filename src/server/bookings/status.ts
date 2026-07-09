/**
 * Single source of truth for "what does a booking status MEAN" — shared by every
 * analytics, seat-hold and guest-checkout surface so the rules can never diverge.
 *
 * Pure & dependency-light (it only duck-types `{ status }` / takes a kind), so it
 * is safe to import from server routes, the attendance/availability engine, AND
 * client components.
 *
 * The seat-hold rule and the revenue rule share the CANCELLED / REFUNDED /
 * PENDING_PAYMENT exclusion: such a booking holds no seat and counts toward no
 * financial figure. They diverge ONLY on the REQUEST-mode states
 * (AWAITING_APPROVAL / APPROVED_UNPAID): those soft-hold the seat — so two
 * users can never both get approved for one slot — but count as NO revenue,
 * because no money has moved yet.
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
 * Does this booking count toward financial figures (revenue, monthly totals)?
 *
 * Excludes the "no money / no value anymore" states:
 *   - CANCELLED / REFUNDED               — gone.
 *   - PENDING_PAYMENT                    — awaiting payment, holds nothing.
 *   - AWAITING_APPROVAL / APPROVED_UNPAID — REQUEST-mode: nothing paid yet.
 */
export function bookingCountsAsRevenue(b: HasStatus): boolean {
  return (
    b.status !== 'CANCELLED' &&
    b.status !== 'REFUNDED' &&
    b.status !== 'PENDING_PAYMENT' &&
    b.status !== 'AWAITING_APPROVAL' &&
    b.status !== 'APPROVED_UNPAID'
  );
}

/**
 * Does this booking occupy capacity (overlap / attendance / desk gates)?
 *
 * Broader than revenue: REQUEST-mode bookings (AWAITING_APPROVAL /
 * APPROVED_UNPAID) soft-hold the seat while unpaid, so overlap detection
 * can never approve two users for the same slot.
 */
export function bookingHoldsSeat(b: HasStatus): boolean {
  return (
    b.status !== 'CANCELLED' &&
    b.status !== 'REFUNDED' &&
    b.status !== 'PENDING_PAYMENT'
  );
}

/**
 * Public guest checkout (no Metwork account) is allowed ONLY for programs.
 * Spaces, events and consultations require a Metwork account and must pass
 * through Metwork payments. The route layer is the authoritative enforcement
 * point; this predicate keeps the rule in one testable place.
 */
export function guestCheckoutAllowedFor(kind: BookingItemKind): boolean {
  return kind === 'PROGRAM';
}
