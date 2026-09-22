/**
 * People who filled in the registration form but never finished paying.
 *
 * Nothing was lost when they walked away — it was only ever invisible. A paid
 * registration goes: form → card intent → hosted checkout → settlement, and
 * the `RegistrationRecord` is written at the END, on settlement. Abandon the
 * checkout and there is no registration at all, so the participants list is
 * empty of them and the bookings list shows a name and an email with no phone
 * and no answers.
 *
 * But the intent itself kept everything: `clientName`, `clientEmail`,
 * `clientPhone` and the whole form in `registrationDraft.answers`, held there
 * precisely so settlement could write them out. This reads that back.
 *
 * Because the data was always being stored, this works retroactively — every
 * abandoned checkout already in the database shows up, not just the ones from
 * here on.
 */
import { db, type BookingRecord } from '@/server/db/store';
import { bookingHoldsSeat, bookingIsDeleted } from '@/server/bookings/status';
import { listRegistrations, type OwnerScope } from '@/server/registrations/service';

export interface AbandonedCheckout {
  /** The most recent attempt's booking id. */
  id: string;
  fullName: string;
  email: string;
  /** The number they typed. The whole point of this view. */
  phone: string;
  /** What they would have paid, in DZD. */
  amount: number;
  /** Their form answers, ready to render against the program's questions. */
  answers: Array<{ fieldId: string; value: string | string[] }>;
  /** When they last tried. */
  lastAttemptAt: string;
  /**
   * EVERY attempt by this person, newest first. Deleting one row has to
   * remove all of them — remove only the latest and the row comes straight
   * back showing the previous attempt.
   */
  bookingIds: string[];
  /**
   * How many times this person started checkout. More than one usually means
   * the payment FAILED rather than that they changed their mind — worth
   * knowing before you pick up the phone.
   */
  attempts: number;
}

/** A person, keyed the way attendance is keyed elsewhere: email, lowercased. */
function personKey(booking: BookingRecord): string {
  return (booking.clientEmail ?? '').trim().toLowerCase() || `booking:${booking.id}`;
}

/**
 * Everyone who started paying for this listing and did not finish.
 *
 * Deliberately excludes anyone who ended up registered anyway: a dead first
 * attempt followed by a successful second one is a paying customer, and
 * putting them on a chase list is the one mistake this view could make that
 * would actually cost something.
 */
export async function listAbandonedCheckouts(
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  owner: OwnerScope,
): Promise<AbandonedCheckout[]> {
  // Owner-scoped: a listing belonging to someone else returns no registrations
  // and, below, no intents either.
  const registrations = await listRegistrations(entityType, entityId, owner);
  const paid = new Set(
    registrations
      .filter((r) => r.status !== 'CANCELLED')
      .map((r) => r.email.trim().toLowerCase()),
  );

  const data = await db.read();
  const owned = ownsListing(data, entityType, entityId, owner);
  if (!owned) return [];

  const byPerson = new Map<string, AbandonedCheckout>();

  for (const booking of data.bookings ?? []) {
    if (booking.itemKind !== entityType || booking.itemId !== entityId) continue;
    // Deleted means gone from the host's lists, and this is one of them —
    // it is also the list the duplicates are deleted FROM.
    if (bookingIsDeleted(booking)) continue;
    // `bookingHoldsSeat` is the single source of truth for "this is live".
    // An unpaid intent is the one booking state it excludes — which is exactly
    // the set we want.
    if (booking.status !== 'PENDING_PAYMENT') continue;
    if (bookingHoldsSeat(booking)) continue;
    // Cash reservations are also PENDING_PAYMENT, but those people have a
    // seat and owe money on the day — they are not abandoned.
    if (booking.paymentMethod !== 'card') continue;

    const email = (booking.clientEmail ?? '').trim().toLowerCase();
    if (email && paid.has(email)) continue; // they came back and paid

    const key = personKey(booking);
    const existing = byPerson.get(key);
    const draft = booking.registrationDraft;

    if (!existing) {
      byPerson.set(key, {
        id: booking.id,
        bookingIds: [booking.id],
        fullName: booking.clientName ?? '—',
        email: booking.clientEmail ?? '',
        phone: booking.clientPhone ?? '',
        amount: booking.totalAmount,
        answers: draft?.answers ?? [],
        lastAttemptAt: booking.createdAt,
        attempts: 1,
      });
      continue;
    }

    existing.attempts += 1;
    existing.bookingIds.push(booking.id);
    // Keep the LATEST attempt's details: a second try may carry a corrected
    // phone number or a different price after a promo code.
    if (booking.createdAt > existing.lastAttemptAt) {
      existing.id = booking.id;
      existing.fullName = booking.clientName ?? existing.fullName;
      existing.phone = booking.clientPhone ?? existing.phone;
      existing.amount = booking.totalAmount;
      existing.lastAttemptAt = booking.createdAt;
      if (draft?.answers?.length) existing.answers = draft.answers;
    }
  }

  // Most recent first: the freshest lead is the one worth calling today.
  return [...byPerson.values()].sort((a, b) => b.lastAttemptAt.localeCompare(a.lastAttemptAt));
}

/** Does this listing belong to the acting owner? */
function ownsListing(
  data: Awaited<ReturnType<typeof db.read>>,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  owner: OwnerScope,
): boolean {
  const row = entityType === 'PROGRAM'
    ? (data.programs ?? []).find((p) => p.id === entityId)
    : (data.events ?? []).find((e) => e.id === entityId);
  if (!row) return false;
  return owner.kind === 'MENTOR'
    ? (row as { mentorId?: string | null }).mentorId === owner.mentorId
    : !(row as { mentorId?: string | null }).mentorId && row.incubatorId === owner.incubatorId;
}
