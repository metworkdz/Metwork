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

export type SettledStatus = 'READY' | 'AWAITING_LINK';

export interface ResolvedSettledStatus {
  status: SettledStatus;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
}

/**
 * Resolve the post-settlement status + meeting fields from the consultant's
 * profile defaults. READY when there is a usable default (in-person, or an
 * online link); otherwise AWAITING_LINK. Pure.
 */
export function resolveSettledStatus(
  mentor: Pick<MentorRecord, 'defaultMeetingMode' | 'defaultMeetingLink'>,
): ResolvedSettledStatus {
  const link = mentor.defaultMeetingLink?.trim();
  if (mentor.defaultMeetingMode === 'OFFLINE') {
    return { status: 'READY', meetingMode: 'OFFLINE', meetingLink: null };
  }
  if (link) {
    return { status: 'READY', meetingMode: 'ONLINE', meetingLink: link };
  }
  return { status: 'AWAITING_LINK', meetingMode: null, meetingLink: null };
}

export type SetMeetingLinkResult =
  | { ok: true; booking: MentorBookingRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_INSTANT_BOOK' | 'WRONG_STATE' | 'LINK_REQUIRED' };

/**
 * Supply (or update) a booking's meeting format. Moves AWAITING_LINK → READY.
 * Only valid for an instant-book booking that is AWAITING_LINK or already READY
 * (re-issuing a link). An ONLINE format requires a non-empty link.
 */
export async function setBookingMeetingLink(input: {
  bookingId: string;
  mode: 'ONLINE' | 'OFFLINE';
  link?: string | null;
}): Promise<SetMeetingLinkResult> {
  const link = input.link?.trim() || null;
  if (input.mode === 'ONLINE' && !link) {
    return { ok: false, reason: 'LINK_REQUIRED' };
  }
  return db.update<SetMeetingLinkResult>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === input.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };
    if (booking.instantBook !== true) return { ok: false, reason: 'NOT_INSTANT_BOOK' };
    if (booking.status !== 'AWAITING_LINK' && booking.status !== 'READY') {
      return { ok: false, reason: 'WRONG_STATE' };
    }
    booking.meetingMode = input.mode;
    booking.meetingLink = input.mode === 'ONLINE' ? link : null;
    booking.status = 'READY';
    booking.updatedAt = new Date().toISOString();
    return { ok: true, booking };
  });
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
