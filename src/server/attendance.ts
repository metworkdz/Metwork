/**
 * Unified attendance counter — the single source of truth for "seats taken"
 * on a program or event.
 *
 * Programs/events can be signed up for through TWO surfaces:
 *   1. Bookings  (wallet/cash/Network Pass, authenticated explorer) — money flows here.
 *   2. Registrations (free guest lead-capture form on the public [slug] pages).
 *
 * Historically these were counted separately, so the public seat badge, the
 * waitlist trigger, the booking capacity gate, and the incubator dashboard all
 * disagreed. This helper reconciles them into one number that every surface
 * reads, WITHOUT touching the wallet/payment paths.
 *
 * A seat is "taken" by:
 *   - any active booking (not CANCELLED / REFUNDED / PENDING_PAYMENT), or
 *   - any CONFIRMED registration (WAITLISTED holds no seat; CANCELLED is gone).
 *
 * PENDING_PAYMENT bookings are unpaid card-deposit intents — they deliberately
 * hold NO seat until the deposit (or full online payment) is verified, at which
 * point the booking flips to CONFIRMED and a commit-time capacity re-check runs.
 *
 * Attendees are deduped by identity (userId, else lowercased email) so a user
 * who both booked and registered counts once. When neither is available the
 * record id is used as its own key (counts as a distinct seat).
 */
import type { BookingRecord, RegistrationRecord } from '@/server/db/store';

type EntityKind = 'PROGRAM' | 'EVENT';

interface AttendanceData {
  bookings?: BookingRecord[] | null;
  registrations?: RegistrationRecord[] | null;
}

/** Stable identity key for deduping a single attendee across both systems. */
function attendeeKey(
  userId: string | null | undefined,
  email: string | null | undefined,
  fallbackId: string,
): string {
  if (userId) return `u:${userId}`;
  if (email && email.trim()) return `e:${email.trim().toLowerCase()}`;
  return `x:${fallbackId}`;
}

/**
 * Count distinct active attendees (bookings + confirmed registrations) for a
 * program or event. Works on any object exposing `bookings`/`registrations`,
 * so it can be called both on a fresh `db.read()` and inside a `db.update`
 * critical section (where it sees the in-flight draft).
 */
export function countAttendance(
  data: AttendanceData,
  kind: EntityKind,
  id: string,
): number {
  const seats = new Set<string>();

  for (const b of data.bookings ?? []) {
    if (b.itemKind !== kind || b.itemId !== id) continue;
    // Unpaid card-deposit intents hold no seat until verified.
    if (b.status === 'CANCELLED' || b.status === 'REFUNDED' || b.status === 'PENDING_PAYMENT') continue;
    seats.add(attendeeKey(b.userId, b.clientEmail, b.id));
  }

  for (const r of data.registrations ?? []) {
    if (r.entityType !== kind || r.entityId !== id) continue;
    if (r.status !== 'CONFIRMED') continue; // WAITLISTED / CANCELLED hold no seat
    seats.add(attendeeKey(r.userId, r.email, r.id));
  }

  return seats.size;
}
