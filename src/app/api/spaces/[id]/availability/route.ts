/**
 * GET /api/spaces/:id/availability?from=ISO&to=ISO — public, canonical.
 *
 * THE single source of truth a calendar reads to grey out unavailable time for a
 * space. It returns every unavailable interval in [from, to], aggregating both:
 *   (i)  active bookings REGARDLESS OF ORIGIN (online + manual/offline),
 *   (ii) owner-set blocks (full-day `unavailableDates` ∪ `blackouts`, partial
 *        time-range blackouts).
 *
 * It is computed by `computeUnavailableIntervals`, the SAME aggregation the
 * booking write gate (`checkSpaceAvailability`) is built on — so the calendar can
 * never show a slot as free that a booking would reject, or vice-versa. A
 * CANCELLED / REFUNDED / PENDING_PAYMENT booking holds no seat and releases its
 * slot here. Read-only; `force-dynamic` so a fresh booking shows immediately.
 *
 * Response shape (stable — consumed by the consultant/Prompt-2 calendar):
 *   {
 *     spaceId, from, to, capacity,
 *     workingDays, openingTime, closingTime,
 *     intervals: [{ start: ISO, end: ISO, kind: 'BOOKING'|'BLOCK', allDay: boolean }]
 *   }
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import {
  computeUnavailableIntervals,
  MAX_AVAILABILITY_RANGE_DAYS,
} from '@/server/bookings/availability';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MS_PER_DAY = 86_400_000;

/** Accept an ISO datetime or a bare YYYY-MM-DD; null when unparseable. */
function parseBound(v: string | null): number | null {
  if (!v) return null;
  const ms = Date.parse(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  return Number.isFinite(ms) ? ms : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await db.read();
  const space = (data.spaces ?? []).find((s) => s.id === id);
  if (!space) return jsonError(404, 'NOT_FOUND', 'Space not found');

  const url = new URL(req.url);
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');

  // Defaults: today → +90 days. Either bound may be supplied; bad input → 400.
  if (fromRaw !== null && parseBound(fromRaw) === null) {
    return jsonError(400, 'INVALID_RANGE', '`from` must be an ISO date or datetime');
  }
  if (toRaw !== null && parseBound(toRaw) === null) {
    return jsonError(400, 'INVALID_RANGE', '`to` must be an ISO date or datetime');
  }
  const fromMs = parseBound(fromRaw) ?? Date.now();
  let toMs = parseBound(toRaw) ?? fromMs + 90 * MS_PER_DAY;
  if (toMs < fromMs) return jsonError(400, 'INVALID_RANGE', '`to` must be on or after `from`');
  // Clamp the span so an over-wide range can't fan out unbounded work.
  const maxToMs = fromMs + MAX_AVAILABILITY_RANGE_DAYS * MS_PER_DAY;
  if (toMs > maxToMs) toMs = maxToMs;

  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();

  const intervals = computeUnavailableIntervals({
    space,
    bookings: data.bookings ?? [],
    spaceId: id,
    from,
    to,
  });

  return json({
    spaceId: id,
    from,
    to,
    capacity: Math.max(1, space.capacity ?? 1),
    workingDays: space.workingDays ?? [1, 2, 3, 4, 5],
    openingTime: space.openingTime ?? '09:00',
    closingTime: space.closingTime ?? '18:00',
    intervals,
  });
}
