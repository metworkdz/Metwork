/**
 * Removing a booking from the host's lists without destroying it.
 *
 * DELETE on a booking used to mean "splice the row out of the store", and it
 * was refused for anything that was not a manual booking — so the rows a host
 * actually wants gone (a cancelled reservation, a duplicate attempt from
 * someone who paid on their second try) could not be removed at all, while the
 * one row that could be removed took its payment evidence with it.
 *
 * So deletion is a flag. The booking keeps everything it had, disappears from
 * every list, and appears on the Deleted tab where it can be restored.
 *
 * TWO RULES carry the weight here:
 *
 *  1. Only a booking that holds NO seat may be deleted (`bookingCanBeDeleted`).
 *     Deleting somebody's confirmed place would erase the person while their
 *     seat, their registration and possibly their payment carried on existing.
 *     Cancel first — that releases the seat — then delete.
 *
 *  2. Silence is deliberate, not a side effect. An unpaid attempt is deleted
 *     without telling anyone: those people abandoned a checkout, often paid
 *     properly on a second try, and an email about a booking they never
 *     completed is confusing at best. A cancelled booking, which the client
 *     knows about, can still be deleted loudly if the host asks for it.
 */
import { db, type BookingRecord } from '@/server/db/store';
import { bookingCanBeDeleted, bookingIsDeleted } from '@/server/bookings/status';

/** The store as db.update() hands it over — same alias the routes use. */
type StoreData = Parameters<Parameters<typeof db.update>[0]>[0];

export type BookingOwner =
  | { kind: 'INCUBATOR'; incubatorId: string }
  | { kind: 'MENTOR'; mentorId: string };

export type DeleteFailure =
  | 'NOT_FOUND'
  /** Returned for someone else's booking too — a stranger learns nothing. */
  | 'HOLDS_SEAT'
  | 'ALREADY_DELETED';

export type DeleteResult =
  | { ok: true; booking: BookingRecord }
  | { ok: false; reason: DeleteFailure };

/**
 * Does `owner` own the listing this booking is against?
 *
 * A booking belongs to whoever owns the space / program / event it is for —
 * there is no owner id on the booking itself.
 */
export function bookingOwnedBy(d: StoreData, owner: BookingOwner, b: BookingRecord): boolean {
  const owns = (row: { incubatorId?: string | null; mentorId?: string | null } | undefined): boolean => {
    if (!row) return false;
    return owner.kind === 'MENTOR'
      ? row.mentorId === owner.mentorId
      : !row.mentorId && row.incubatorId === owner.incubatorId;
  };
  if (b.itemKind === 'SPACE')   return owns((d.spaces   ?? []).find((s) => s.id === b.itemId));
  if (b.itemKind === 'PROGRAM') return owns((d.programs ?? []).find((p) => p.id === b.itemId));
  if (b.itemKind === 'EVENT')   return owns((d.events   ?? []).find((e) => e.id === b.itemId));
  return false;
}

/**
 * Hide a booking. `actorId` is recorded for the audit trail.
 *
 * A booking the owner does not own reports NOT_FOUND rather than a refusal:
 * a stranger probing ids learns nothing about what exists.
 */
export async function softDeleteBooking(
  bookingId: string,
  owner: BookingOwner,
  actorId: string | null,
): Promise<DeleteResult> {
  return db.update<DeleteResult>((d) => {
    const booking = (d.bookings ?? []).find((b) => b.id === bookingId);
    if (!booking || !bookingOwnedBy(d, owner, booking)) return { ok: false, reason: 'NOT_FOUND' };
    if (bookingIsDeleted(booking)) return { ok: false, reason: 'ALREADY_DELETED' };
    if (!bookingCanBeDeleted(booking)) return { ok: false, reason: 'HOLDS_SEAT' };

    const now = new Date().toISOString();
    booking.deletedAt = now;
    booking.deletedBy = actorId;
    booking.updatedAt = now;

    // A desk hold left behind by a deleted booking would block that desk for
    // good. Cancelled and pending bookings should already have released
    // theirs; this is the belt to that braces.
    for (const desk of d.deskBookings ?? []) {
      if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') desk.status = 'CANCELLED';
    }

    return { ok: true, booking: { ...booking } };
  });
}

export type RestoreResult =
  | { ok: true; booking: BookingRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_DELETED' };

/** Put a deleted booking back on the list. */
export async function restoreBooking(
  bookingId: string,
  owner: BookingOwner,
): Promise<RestoreResult> {
  return db.update<RestoreResult>((d) => {
    const booking = (d.bookings ?? []).find((b) => b.id === bookingId);
    if (!booking || !bookingOwnedBy(d, owner, booking)) return { ok: false, reason: 'NOT_FOUND' };
    if (!bookingIsDeleted(booking)) return { ok: false, reason: 'NOT_DELETED' };

    booking.deletedAt = null;
    booking.deletedBy = null;
    booking.updatedAt = new Date().toISOString();
    return { ok: true, booking: { ...booking } };
  });
}

/**
 * Should deleting this booking tell the client?
 *
 * Never for an unpaid attempt: they abandoned a checkout and may well have
 * paid on a later try, so an email about it is noise at best and alarming at
 * worst. The host can still ask for a notification on anything else.
 */
export function deleteNotifiesClient(b: BookingRecord, requested: boolean | undefined): boolean {
  if (b.status === 'PENDING_PAYMENT') return false;
  return requested ?? false;
}
