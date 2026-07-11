/**
 * Slot locks — short-lived holds taken at payment INITIATION (not settlement).
 *
 * When a client begins paying for a consultation slot, `lockSlot` places a
 * TTL-bounded hold so a second concurrent client can't pay for the same time.
 * The hold is released explicitly on payment failure/cancel (`releaseSlot`) or
 * implicitly when it expires. The shared `computeBookableSlots` validator treats
 * an unexpired lock as occupied, so a held slot disappears from availability.
 *
 * All mutations run inside a single atomic `db.update`, so the check-and-set is
 * race-safe against the single-document JSONB store. Release is idempotent
 * (keyed by the originating booking id).
 *
 * NOT wired into the payment flow here — that happens in a later prompt. This
 * module only provides the helpers + concurrency guarantees.
 */
import { db, type MentorSlotLockRecord } from '@/server/db/store';
import { mentorBookingHoldsSeat } from '@/server/mentors/availability';

/** Default hold window — long enough to complete a hosted checkout. */
export const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

const HHMM_RE = /^\d{2}:\d{2}$/;

function toMinutes(hhmm: string): number {
  if (!HHMM_RE.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  if (h! > 23 || m! > 59) return NaN;
  return h! * 60 + m!;
}

/** Half-open overlap test: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function lockInterval(lock: Pick<MentorSlotLockRecord, 'startTime' | 'durationMinutes'>): {
  start: number;
  end: number;
} | null {
  const start = toMinutes(lock.startTime);
  if (Number.isNaN(start)) return null;
  const dur = lock.durationMinutes > 0 ? lock.durationMinutes : 60;
  return { start, end: start + dur };
}

export interface LockSlotInput {
  bookingId: string;
  mentorId: string;
  /** "YYYY-MM-DD" of the slot. */
  date: string;
  /** "HH:MM" start (mentor local time). */
  startTime: string;
  durationMinutes: number;
  /** Override the hold window. Defaults to DEFAULT_LOCK_TTL_MS. */
  ttlMs?: number;
}

export type LockSlotResult =
  | { ok: true; expiresAt: string }
  | { ok: false; reason: 'SLOT_TAKEN' | 'INVALID' };

/**
 * Atomically place (or refresh) a hold on a slot. Idempotent for the same
 * `bookingId` — a retry refreshes the existing hold rather than failing.
 * Fails with SLOT_TAKEN when a *different* booking already holds an overlapping
 * unexpired lock. Sweeps expired locks as a side effect.
 */
export async function lockSlot(input: LockSlotInput): Promise<LockSlotResult> {
  const candidate = lockInterval({ startTime: input.startTime, durationMinutes: input.durationMinutes });
  if (!candidate) return { ok: false, reason: 'INVALID' };

  const now = Date.now();
  const ttl = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_LOCK_TTL_MS;
  const expiresAt = new Date(now + ttl).toISOString();

  return db.update<LockSlotResult>((d) => {
    if (!Array.isArray(d.mentorSlotLocks)) d.mentorSlotLocks = [];

    // Drop expired locks globally so the table doesn't grow unbounded.
    d.mentorSlotLocks = d.mentorSlotLocks.filter((l) => new Date(l.expiresAt).getTime() > now);

    // Conflict check (i): another booking holding an overlapping unexpired lock.
    const lockConflict = d.mentorSlotLocks.some((l) => {
      if (l.bookingId === input.bookingId) return false; // our own hold — not a conflict
      if (l.mentorId !== input.mentorId || l.date !== input.date) return false;
      const iv = lockInterval(l);
      return iv ? overlaps(candidate.start, candidate.end, iv.start, iv.end) : false;
    });
    if (lockConflict) return { ok: false, reason: 'SLOT_TAKEN' };

    // Conflict check (ii): an already-persisted seat-holding booking overlapping
    // this slot. Reading `d.mentorBookings` inside the SAME atomic mutation makes
    // the acquisition a complete reservation — it closes the window between a
    // caller's pre-read availability check and this lock, so two payers can never
    // both land on a time even if the first settled between the other's read and
    // its lock. A null-time legacy booking occupies its whole day.
    const bookingConflict = (d.mentorBookings ?? []).some((b) => {
      if (b.id === input.bookingId) return false; // our own booking — not a conflict
      if (b.mentorId !== input.mentorId) return false;
      if (!mentorBookingHoldsSeat(b.status)) return false;
      if (b.consultationDate !== input.date) return false;
      if (!b.consultationTime) return true; // whole-day legacy hold
      const bStart = toMinutes(b.consultationTime);
      if (Number.isNaN(bStart)) return false;
      const bDur = b.durationMinutes && b.durationMinutes > 0 ? b.durationMinutes : 60;
      return overlaps(candidate.start, candidate.end, bStart, bStart + bDur);
    });
    if (bookingConflict) return { ok: false, reason: 'SLOT_TAKEN' };

    // Refresh our own hold if present, else create it.
    const existing = d.mentorSlotLocks.find((l) => l.bookingId === input.bookingId);
    if (existing) {
      existing.mentorId = input.mentorId;
      existing.date = input.date;
      existing.startTime = input.startTime;
      existing.durationMinutes = input.durationMinutes;
      existing.expiresAt = expiresAt;
    } else {
      d.mentorSlotLocks.push({
        bookingId: input.bookingId,
        mentorId: input.mentorId,
        date: input.date,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        expiresAt,
        createdAt: new Date(now).toISOString(),
      });
    }
    return { ok: true, expiresAt };
  });
}

/** Release a hold (payment failure/timeout/cancel). Idempotent by bookingId. */
export async function releaseSlot(bookingId: string): Promise<void> {
  await db.update((d) => {
    d.mentorSlotLocks = (d.mentorSlotLocks ?? []).filter((l) => l.bookingId !== bookingId);
  });
}

/** True when an unexpired lock (held by ANY booking) overlaps the given slot. */
export async function isSlotLocked(
  mentorId: string,
  date: string,
  startTime: string,
  durationMinutes: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const candidate = lockInterval({ startTime, durationMinutes });
  if (!candidate) return false;
  const data = await db.read();
  return (data.mentorSlotLocks ?? []).some((l) => {
    if (l.mentorId !== mentorId || l.date !== date) return false;
    if (new Date(l.expiresAt).getTime() <= nowMs) return false;
    const iv = lockInterval(l);
    return iv ? overlaps(candidate.start, candidate.end, iv.start, iv.end) : false;
  });
}
