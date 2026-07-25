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
import { createZoomMeeting, isZoomConfigured } from '@/server/integrations/zoom';

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

export interface ResolvedSettledStatusWithZoom extends ResolvedSettledStatus {
  meetingSource: 'auto' | 'manual' | 'offline' | null;
  zoomJoinUrl: string | null;
  zoomStartUrl: string | null;
  zoomMeetingId: string | null;
}

export interface ResolveSettledStatusWithZoomInput {
  mentor: Pick<
    MentorRecord,
    'defaultMeetingMode' | 'defaultMeetingLink' | 'defaultMeetingAddress' | 'defaultMeetingMapsLink' | 'fullName'
  >;
  /** Zoom meeting topic (no client PII — mirrors the WhatsApp template's rule). */
  topic: string;
  /** "YYYY-MM-DD" + "HH:MM" combined, no UTC offset (Zoom wants local wall-clock time + a timezone). Null when no concrete slot was chosen — Zoom is skipped in that case, same as today's AWAITING_LINK fallback. */
  startTimeIso: string | null;
  durationMinutes: number;
  /** Already-set zoomMeetingId on the booking, if any — guards against creating a duplicate meeting on a retried settlement call. */
  existingZoomMeetingId?: string | null;
}

const NO_ZOOM: Pick<ResolvedSettledStatusWithZoom, 'meetingSource' | 'zoomJoinUrl' | 'zoomStartUrl' | 'zoomMeetingId'> = {
  meetingSource: null,
  zoomJoinUrl: null,
  zoomStartUrl: null,
  zoomMeetingId: null,
};

/**
 * `resolveSettledStatus` plus Zoom auto-generation for the one gap it leaves:
 * an ONLINE-or-unset consultant default with no link. Auto-generation NEVER
 * overrides a consultant's own default link/address (Option A — a consultant
 * who already configured their own meeting link keeps it untouched) and never
 * fills the OFFLINE-without-address gap (Zoom can't produce a physical
 * address). On any Zoom failure this falls back to the exact same
 * AWAITING_LINK result `resolveSettledStatus` would have returned — the
 * consultant supplies a link later via `setBookingMeetingLink`, unchanged.
 */
export async function resolveSettledStatusWithZoom(
  input: ResolveSettledStatusWithZoomInput,
): Promise<ResolvedSettledStatusWithZoom> {
  const base = resolveSettledStatus(input.mentor);

  if (base.status === 'READY') {
    // Consultant already has a usable default — respect it, untouched.
    return { ...base, ...NO_ZOOM, meetingSource: base.meetingMode === 'OFFLINE' ? 'offline' : 'manual' };
  }
  // AWAITING_LINK. Only the "online link missing" gap is fillable by Zoom —
  // an OFFLINE default with no address is a physical-location gap.
  if (input.mentor.defaultMeetingMode === 'OFFLINE') {
    return { ...base, ...NO_ZOOM };
  }
  if (input.existingZoomMeetingId) {
    // Already auto-generated for this booking (retried settlement call) —
    // never create a second meeting.
    return { ...base, ...NO_ZOOM, zoomMeetingId: input.existingZoomMeetingId };
  }
  if (!isZoomConfigured() || !input.startTimeIso) {
    return { ...base, ...NO_ZOOM };
  }

  try {
    const meeting = await createZoomMeeting({
      topic: input.topic,
      startTime: input.startTimeIso,
      durationMinutes: input.durationMinutes,
    });
    return {
      status: 'READY',
      meetingMode: 'ONLINE',
      meetingLink: meeting.joinUrl,
      meetingAddress: null,
      meetingMapsLink: null,
      meetingSource: 'auto',
      zoomJoinUrl: meeting.joinUrl,
      zoomStartUrl: meeting.startUrl,
      zoomMeetingId: meeting.meetingId,
    };
  } catch (err) {
    // Non-blocking: never let a Zoom failure disturb settlement. Fall back to
    // AWAITING_LINK exactly as it worked before Zoom existed.
    // eslint-disable-next-line no-console
    console.error('[zoom] auto-generation failed, falling back to AWAITING_LINK →', err instanceof Error ? err.message : err);
    return { ...base, ...NO_ZOOM };
  }
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
    // Manually (re)supplied by the consultant/admin — overrides any prior
    // auto-generated Zoom link. The zoomJoinUrl/zoomStartUrl/zoomMeetingId
    // fields are left as historical record, not cleared.
    booking.meetingSource = input.mode === 'OFFLINE' ? 'offline' : 'manual';
    booking.status = 'READY';
    booking.updatedAt = new Date().toISOString();
    return { ok: true, booking };
  });
  // Notify the client that the session is ready (deduped via linkSentAt).
  // AWAITED: fire-and-forget promises are killed when the serverless response
  // returns — this is exactly how approval emails were getting lost.
  if (result.ok) await sendConsultationReadyOnce(result.booking.id);
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
