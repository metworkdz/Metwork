/**
 * Which client-book entry a contract is about.
 *
 * A contract needs the client's ID number and address, and the only place those
 * live is the incubator's client book (`ClientRecord`). A booking used to carry a
 * name and an email and nothing connecting it to that entry, so the contract
 * printed a blank where the ID should be and had no address at all.
 *
 * New bookings carry an explicit `clientId` (an unambiguous link, verified against
 * the incubator when it was written). Bookings made before that — and online ones
 * the client made themselves — are matched here, and the matching is deliberately
 * cautious, because the output is a legal document: a match must be UNIQUE within
 * this incubator's own book, and the weakest signal (a bare name) is only trusted
 * when the booking has no email or phone that could have told two people apart.
 * An ambiguous or missing match yields nothing — a blank the host can see and fill
 * is better than another person's ID number on a signed contract.
 */
import type { BookingRecord, ClientRecord, UserRecord } from '@/server/db/store';

export interface ContractClientMatch {
  client: ClientRecord;
  /** True when the booking carries an explicit `clientId` link rather than a guessed match. */
  linked: boolean;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Last 9 digits: tolerates +213 / 0 prefixes and spaces without conflating different numbers. */
const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-9);

function unique<T>(rows: T[]): T | null {
  return rows.length === 1 ? rows[0]! : null;
}

export function findContractClient(
  clients: ClientRecord[] | undefined,
  incubatorId: string,
  booking: Pick<BookingRecord, 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
  user: Pick<UserRecord, 'email' | 'phone' | 'fullName'> | null,
): ContractClientMatch | null {
  // This incubator's own book only — a consultant's clients, or another incubator's, never match.
  const mine = (clients ?? []).filter((c) => c.incubatorId === incubatorId && !c.mentorId);

  if (booking.clientId) {
    const linked = mine.find((c) => c.id === booking.clientId);
    if (linked) return { client: linked, linked: true };
    // The client was deleted since: fall through to matching rather than printing nothing.
  }

  const emails = [booking.clientEmail, user?.email].map(norm).filter(Boolean);
  for (const e of emails) {
    const hit = unique(mine.filter((c) => norm(c.email) === e));
    if (hit) return { client: hit, linked: false };
  }

  const phones = [booking.clientPhone, user?.phone].map(phoneKey).filter((p) => p.length >= 8);
  for (const p of phones) {
    const hit = unique(mine.filter((c) => phoneKey(c.phone) === p));
    if (hit) return { client: hit, linked: false };
  }

  // Bare name: only when nothing else on the booking could have disambiguated.
  if (emails.length === 0 && phones.length === 0) {
    const name = norm(user?.fullName ?? booking.clientName);
    if (name) {
      const hit = unique(mine.filter((c) => norm(c.fullName) === name));
      if (hit) return { client: hit, linked: false };
    }
  }
  return null;
}
