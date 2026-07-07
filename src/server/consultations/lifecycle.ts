/**
 * Instant-book consultation lifecycle: meeting-link resolution and completion.
 *
 * After a pay-first booking settles it lands in one of two states:
 *   READY         — a meeting format is set (online link or in-person), so the
 *                   session can go ahead.
 *   AWAITING_LINK — paid & confirmed, but the consultant has not provided a
 *                   meeting link yet (no usable profile default).
 *
 * The consultant later supplies a link (AWAITING_LINK → READY), and once the
 * session has happened it is marked COMPLETED — the transition that releases the
 * consultant's held (PENDING) earning to AVAILABLE.
 *
 * Money note: completion is the ONLY place a pay-first earning is released. The
 * release is idempotent (P1 ledger, keyed per booking), and completion itself
 * no-ops if already completed.
 */
import {
  db,
  type MentorBookingRecord,
  type MentorRecord,
} from '@/server/db/store';
import { releaseToAvailable } from '@/server/mentors/ledger';
import { sendConsultationReadyOnce } from '@/server/notifications/consultation-ready';

export type SettledStatus = 'READY' | 'AWAITING_LINK';

export interface ResolvedSettledStatus {
  status: SettledStatus;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
  meetingAddress: string | null;
  meetingMapsLink: string | null;
}

/**
 * Resolve the post-settlement status + meeting fields from the consultant's
 * profile defaults. READY when there is a usable default (an online link, OR an
 * in-person address); otherwise AWAITING_LINK so the consultant supplies the
 * details per booking. Pure.
 */
export function resolveSettledStatus(
  mentor: Pick<
    MentorRecord,
    'defaultMeetingMode' | 'defaultMeetingLink' | 'defaultMeetingAddress' | 'defaultMeetingMapsLink'
  >,
): ResolvedSettledStatus {
  const link = mentor.defaultMeetingLink?.trim();
  const address = mentor.defaultMeetingAddress?.trim();
  const mapsLink = mentor.defaultMeetingMapsLink?.trim() || null;
  if (mentor.defaultMeetingMode === 'OFFLINE') {
    // In-person needs an address to be deliverable; without one, wait for it.
    if (address) {
      return { status: 'READY', meetingMode: 'OFFLINE', meetingLink: null, meetingAddress: address, meetingMapsLink: mapsLink };
    }
    return { status: 'AWAITING_LINK', meetingMode: null, meetingLink: null, meetingAddress: null, meetingMapsLink: null };
  }
  if (link) {
    return { status: 'READY', meetingMode: 'ONLINE', meetingLink: link, meetingAddress: null, meetingMapsLink: null };
  }
  return { status: 'AWAITING_LINK', meetingMode: null, meetingLink: null, meetingAddress: null, meetingMapsLink: null };
}

export type SetMeetingLinkResult =
  | { ok: true; booking: MentorBookingRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_INSTANT_BOOK' | 'WRONG_STATE' | 'LINK_REQUIRED' | 'ADDRESS_REQUIRED' };

/**
 * Supply (or update) a booking's meeting format. Moves AWAITING_LINK → READY.
 * Only valid for an instant-book booking that is AWAITING_LINK or already READY
 * (re-issuing details). An ONLINE format requires a non-empty link; an OFFLINE
 * format requires a non-empty address (the Google Maps link is optional).
 */
export async function setBookingMeetingLink(input: {
  bookingId: string;
  mode: 'ONLINE' | 'OFFLINE';
  link?: string | null;
  address?: string | null;
  mapsLink?: string | null;
}): Promise<SetMeetingLinkResult> {
  const link = input.link?.trim() || null;
  const address = input.address?.trim() || null;
  const mapsLink = input.mapsLink?.trim() || null;
  if (input.mode === 'ONLINE' && !link) {
    return { ok: false, reason: 'LINK_REQUIRED' };
  }
  if (input.mode === 'OFFLINE' && !address) {
    return { ok: false, reason: 'ADDRESS_REQUIRED' };
  }
  const result = await db.update<SetMeetingLinkResult>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === input.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };
    if (booking.instantBook !== true) return { ok: false, reason: 'NOT_INSTANT_BOOK' };
    if (booking.status !== 'AWAITING_LINK' && booking.status !== 'READY') {
      return { ok: false, reason: 'WRONG_STATE' };
    }
    const nextLink = input.mode === 'ONLINE' ? link : null;
    const nextAddress = input.mode === 'OFFLINE' ? address : null;
    const nextMapsLink = input.mode === 'OFFLINE' ? mapsLink : null;
    // When the meeting details actually CHANGE on an already-notified booking,
    // clear the dedup stamp so the client is re-notified with the corrected
    // details — a stale link in their inbox is worse than a second email.
    // Re-saving identical details keeps the stamp (no duplicate send).
    const changed =
      booking.meetingMode !== input.mode ||
      (booking.meetingLink ?? null) !== nextLink ||
      (booking.meetingAddress ?? null) !== nextAddress ||
      (booking.meetingMapsLink ?? null) !== nextMapsLink;
    if (changed && booking.linkSentAt) booking.linkSentAt = null;
    booking.meetingMode = input.mode;
    booking.meetingLink = nextLink;
    booking.meetingAddress = nextAddress;
    booking.meetingMapsLink = nextMapsLink;
    booking.status = 'READY';
    booking.updatedAt = new Date().toISOString();
    return { ok: true, booking };
  });
  // Notify the client that the session is ready (deduped via linkSentAt).
  if (result.ok) void sendConsultationReadyOnce(result.booking.id);
  return result;
}

export type CompleteConsultationResult =
  | { ok: true; replayed: boolean; booking: MentorBookingRecord; released: number }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_INSTANT_BOOK' | 'WRONG_STATE' };

/** States from which a session may be marked COMPLETED. */
const COMPLETABLE = new Set(['READY', 'AWAITING_LINK', 'CONFIRMED']);

/**
 * Mark a settled consultation COMPLETED and release the consultant's held
 * earning (PENDING → AVAILABLE). Idempotent: a second call replays without
 * double-releasing.
 */
export async function completeConsultation(bookingId: string): Promise<CompleteConsultationResult> {
  const claim = await db.update<
    | { kind: 'claimed' | 'replay'; booking: MentorBookingRecord }
    | { kind: 'error'; reason: 'NOT_FOUND' | 'NOT_INSTANT_BOOK' | 'WRONG_STATE' }
  >((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return { kind: 'error', reason: 'NOT_FOUND' };
    if (booking.instantBook !== true) return { kind: 'error', reason: 'NOT_INSTANT_BOOK' };
    if (booking.status === 'COMPLETED') return { kind: 'replay', booking };
    if (!COMPLETABLE.has(booking.status)) return { kind: 'error', reason: 'WRONG_STATE' };

    const now = new Date().toISOString();
    booking.status = 'COMPLETED';
    booking.completedAt = now;
    booking.updatedAt = now;
    return { kind: 'claimed', booking };
  });

  if (claim.kind === 'error') return { ok: false, reason: claim.reason };

  // Release the held earning. Idempotent per booking, so the replay path stays
  // safe; returns 0 released when there was nothing pending (e.g. free booking).
  const release = await releaseToAvailable({ mentorId: claim.booking.mentorId, bookingId });
  const released = release.ok ? release.released : 0;
  return { ok: true, replayed: claim.kind === 'replay', booking: claim.booking, released };
}
