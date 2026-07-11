/**
 * GET /api/mentors/:id/availability — PUBLIC, read-only.
 *
 * Two query shapes (both accept an optional `durationMinutes`, default 60 —
 * availability is duration-aware, so a longer session greys out starts that
 * would run past a window end):
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD[&durationMinutes=N] → { availableDates, timezone }
 *       Range is clamped to [today, today + 90 days]; `from` never goes into
 *       the past. Defaults: from = today, to = today + 90.
 *   ?date=YYYY-MM-DD[&durationMinutes=N]               → { slots, durationMinutes, timezone }
 *       The concrete HOUR-ALIGNED bookable slots for one day at that duration.
 *
 * Everything is derived from existing records via the shared, pure
 * `computeHourlySlots` validator in `@/server/mentors/availability` — the SAME
 * authority the booking write-gate and reschedule use. So the public display
 * subtracts active slot-locks, the min-notice window and the buffer, and never
 * advertises a slot the booking gate would then refuse. No writes, no side effects.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { computeHourlySlots, computeAvailableDatesHourly } from '@/server/mentors/availability';
import { isMentorApproved } from '@/lib/mentor-approval';
import { DEFAULT_AVAILABILITY_TIMEZONE } from '@/types/mentor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RANGE_DAYS = 90;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DURATION = 60;

/** Parse & clamp the optional duration param to the supported 30–180 range. */
function parseDuration(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 30 || n > 180) return DEFAULT_DURATION;
  return n;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/** Today as "YYYY-MM-DD" in the given IANA timezone. */
function todayInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
  }
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(Date.UTC(y!, m! - 1, d!) + delta * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${nd.getUTCFullYear()}-${pad(nd.getUTCMonth() + 1)}-${pad(nd.getUTCDate())}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`mentor-availability:${ip}`, 120, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.');
  }

  const { id } = await params;
  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === id);
  // Public route — non-APPROVED self-signups 404 like missing mentors.
  if (!mentor || !isMentorApproved(mentor)) {
    return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
  }

  const timezone = mentor.availabilityTimezone ?? DEFAULT_AVAILABILITY_TIMEZONE;
  const bookings = (data.mentorBookings ?? []).filter((b) => b.mentorId === id);
  const slotLocks = data.mentorSlotLocks ?? [];
  const { searchParams } = new URL(req.url);
  const durationMinutes = parseDuration(searchParams.get('durationMinutes'));

  // ── Single-day HOUR-ALIGNED slots ─────────────────────────────────────────
  const dateParam = searchParams.get('date');
  if (dateParam !== null) {
    if (!ISO_DATE_RE.test(dateParam)) {
      return jsonError(422, 'INVALID_DATE', 'date must be in YYYY-MM-DD format');
    }
    const slots = computeHourlySlots(mentor, dateParam, durationMinutes, bookings, {
      slotLocks,
    }).map((s) => ({ start: s.start, end: s.end, available: s.available }));
    return json({ date: dateParam, durationMinutes, slots, timezone });
  }

  // ── Date range → available dates ──────────────────────────────────────────
  const today = todayInTz(timezone);
  const maxTo = addDaysISO(today, MAX_RANGE_DAYS);

  const fromRaw = searchParams.get('from');
  const toRaw = searchParams.get('to');

  if (fromRaw !== null && !ISO_DATE_RE.test(fromRaw)) {
    return jsonError(422, 'INVALID_DATE', 'from must be in YYYY-MM-DD format');
  }
  if (toRaw !== null && !ISO_DATE_RE.test(toRaw)) {
    return jsonError(422, 'INVALID_DATE', 'to must be in YYYY-MM-DD format');
  }

  // Clamp: from never before today; to never beyond today + 90 days.
  const from = fromRaw && fromRaw > today ? fromRaw : today;
  let to = toRaw ?? maxTo;
  if (to > maxTo) to = maxTo;
  if (to < from) to = from;

  const availableDates = computeAvailableDatesHourly(mentor, from, to, durationMinutes, bookings, {
    slotLocks,
  });
  return json({ availableDates, from, to, durationMinutes, timezone });
}
