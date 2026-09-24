/**
 * Record a participant who signed up AT THE DESK.
 *
 * Someone walks into the office, takes a seat on a paid training and hands
 * over cash. Before this existed the only way to record that was a manual
 * booking, which fixed the seat count but left the person missing from the
 * participants list, carried no deposit/balance split, and sent them nothing.
 * The host ended up tracking the balance on paper.
 *
 * This deliberately reuses the SAME cash-reservation path the public link
 * uses (`insertRegistrationSync`), rather than adding a second way to seat
 * somebody. One writer means the two surfaces cannot drift on the things that
 * matter — capacity, the duplicate guard, the CRM client upsert, and how a
 * balance owed is represented.
 *
 * What comes out of it:
 *   • a CONFIRMED registration — she appears in Participants
 *   • a CONFIRMED offline booking carrying deposit + balance, which
 *     "Mark cash paid" closes when she settles up
 *   • the seat counted exactly once (booking and registration dedupe by email)
 *   • the localized confirmation email, stating what she paid and what is left
 *   • the stamped PDF receipt for the cash she handed over
 *
 * No money moves on the platform and no commission is taken: the cash went
 * hand to hand in the office, and the platform was never in the middle of it.
 */
import { db, type RegistrationRecord } from '@/server/db/store';
import { countAttendance } from '@/server/attendance';
import { resolveListingPricing } from '@/lib/listing-price';
import { applyClockTime, isClockTime } from '@/lib/booking-when';
import { dispatchReceiptIfDue } from '@/server/bookings/card-payment';
import {
  createRegistration,
  findMissingRequiredAnswer,
  type OwnerScope,
} from './service';
import { programDates } from '@/lib/program-dates';

export interface AddParticipantInput {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  /** Who is recording this — used for ownership AND the cash-collected stamp. */
  owner: OwnerScope;
  actorId: string;
  fullName: string;
  email: string;
  phone: string;
  answers: Array<{ fieldId: string; value: string | string[] }>;
  locale?: string | null;
  /** Cash taken now, in DZD. 0 = seated but owes the whole amount. */
  depositPaid: number;
  /**
   * Total for this person. Defaults to the listing's CASH price — the host may
   * override it, because a desk deal (a partner rate, a returning client) is a
   * real thing that the published price cannot express.
   */
  totalAmount?: number | null;
}

export type AddParticipantResult =
  | {
      ok: true;
      registration: RegistrationRecord;
      totalAmount: number;
      depositPaid: number;
      dueOnSite: number;
    }
  | { ok: false; reason: 'NOT_FOUND' | 'FULL' | 'ALREADY_REGISTERED' }
  | { ok: false; reason: 'MISSING_REQUIRED_FIELD'; fieldId: string; label: string };

/** The listing, flattened to what a booking snapshot needs. */
interface ListingSnapshot {
  id: string;
  title: string;
  vendorName: string;
  city: string;
  /** Null while a program's dates are to confirm: no booking, no money. */
  startsAt: string | null;
  endsAt: string | null;
  startsAtHasClockTime: boolean;
  cashPrice: number;
  seatsTotal: number;
}

export async function addOfflineRegistration(
  input: AddParticipantInput,
): Promise<AddParticipantResult> {
  const data = await db.read();

  let listing: ListingSnapshot | null = null;
  if (input.entityType === 'PROGRAM') {
    const p = (data.programs ?? []).find((x) => x.id === input.entityId);
    if (!p) return { ok: false, reason: 'NOT_FOUND' };
    if (!ownsListing(p, input.owner)) return { ok: false, reason: 'NOT_FOUND' };
    const dates = programDates(p);
    listing = {
      id: p.id,
      title: p.title,
      vendorName: p.incubatorName ?? p.mentorName ?? 'Metwork',
      city: p.city,
      // Same clock-time handling as the public link, so the booking a walk-in
      // gets carries the real start hour rather than the storage anchor.
      startsAt: dates ? applyClockTime(dates.startDate, p.startTime) : null,
      startsAtHasClockTime: isClockTime(p.startTime),
      endsAt: dates ? dates.endDate : null,
      cashPrice: resolveListingPricing(p.price, p).cash,
      seatsTotal: p.seatsTotal,
    };
  } else {
    const e = (data.events ?? []).find((x) => x.id === input.entityId);
    if (!e) return { ok: false, reason: 'NOT_FOUND' };
    if (!ownsListing(e, input.owner)) return { ok: false, reason: 'NOT_FOUND' };
    listing = {
      id: e.id,
      title: e.title,
      vendorName: e.incubatorName,
      city: e.city,
      startsAt: e.eventDate,
      startsAtHasClockTime: false,
      endsAt: e.eventDate,
      cashPrice: resolveListingPricing(e.price, e).cash,
      seatsTotal: e.capacity,
    };
  }

  // Capacity, read the same way every other surface reads it. A host adding
  // someone at the desk is exactly when a room quietly goes over its number.
  if (countAttendance(data, input.entityType, input.entityId) >= listing.seatsTotal) {
    return { ok: false, reason: 'FULL' };
  }

  // The desk answers the same required questions the public form does —
  // otherwise a walk-in arrives with half a record and the host finds out on
  // the day that they never asked.
  const missing = findMissingRequiredAnswer(data, input.entityType, input.entityId, input.answers);
  if (missing) return { ok: false, reason: 'MISSING_REQUIRED_FIELD', ...missing };

  // A program whose dates are to confirm takes a pre-registration at the
  // desk too: the person is recorded, no booking and no money (a booking is a
  // date). See @/lib/program-dates.
  const preRegistration = !listing.startsAt || !listing.endsAt;
  const totalAmount = preRegistration ? 0 : Math.max(
    0,
    Math.round(input.totalAmount ?? listing.cashPrice),
  );
  const depositPaid = Math.min(Math.max(0, Math.round(input.depositPaid)), totalAmount);

  const email = input.email.trim().toLowerCase();
  const { registration, alreadyRegistered } = await createRegistration({
    entityType: input.entityType,
    entityId: input.entityId,
    userId: null,
    fullName: input.fullName,
    email,
    phone: input.phone,
    answers: input.answers,
    locale: input.locale ?? null,
    cashReservation: !listing.startsAt || !listing.endsAt ? null : {
      listing: {
        id: listing.id,
        title: listing.title,
        vendorName: listing.vendorName,
        city: listing.city,
        startsAt: listing.startsAt,
        endsAt: listing.endsAt,
        startsAtHasClockTime: listing.startsAtHasClockTime,
      },
      amountDue: totalAmount,
      // Scoped to the listing + person, so a double submit at the desk finds
      // the booking it already wrote instead of billing her twice.
      clientReference: `desk-${listing.id}-${email}`,
      depositPaidAmount: depositPaid,
      offline: true,
      collectedByActorId: input.actorId,
    },
  });

  // She was already on the list. Say so plainly rather than pretending a
  // second seat was created — the desk needs to know it is a duplicate.
  if (alreadyRegistered) return { ok: false, reason: 'ALREADY_REGISTERED' };

  // She handed over money at the desk, so she is owed a receipt for it — the
  // same stamped PDF a card payer gets. Which one goes out is decided by what
  // was actually received: paid in full → final, a deposit → deposit receipt,
  // nothing yet → none. Awaited so the PDF is really sent before the request
  // ends; it never throws, so a mail failure cannot undo the seat.
  if (registration.bookingId) await dispatchReceiptIfDue(registration.bookingId);

  return {
    ok: true,
    registration,
    totalAmount,
    depositPaid,
    dueOnSite: totalAmount - depositPaid,
  };
}

function ownsListing(
  row: { incubatorId?: string | null; mentorId?: string | null },
  scope: OwnerScope,
): boolean {
  return scope.kind === 'MENTOR'
    ? row.mentorId === scope.mentorId
    : !row.mentorId && row.incubatorId === scope.incubatorId;
}
