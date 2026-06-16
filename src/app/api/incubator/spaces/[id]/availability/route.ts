/**
 * GET  /api/incubator/spaces/:id/availability — public.
 *   - no query           → { unavailableDates }                    (legacy shape, unchanged)
 *   - ?month=YYYY-MM      → { availableDates, unavailableDates, fullyBookedDates, ...config }
 *   - ?date=YYYY-MM-DD    → { slots }  (hourly blocks, overlap + capacity aware)
 *
 *   The month/date branches are READ-ONLY views that *surface* the exact rules
 *   `createSpaceBooking` already enforces (working days/hours, blocked dates,
 *   concurrent-occupancy capacity). They never mutate state or change those
 *   rules — they only let the UI grey out what the server would reject.
 *
 * PUT  /api/incubator/spaces/:id/availability — incubator manager; replaces blocked dates.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type BookingRecord, type SpaceRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import type { DaySlot } from '@/types/mentor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  /** Array of YYYY-MM-DD date strings to block full-day. Empty array clears all. */
  unavailableDates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Each date must be YYYY-MM-DD'),
  ).max(365),
  /**
   * Optional time-range blackouts. When `from`/`to` are present only that range
   * on `date` is blocked; otherwise the whole day. Omit the field to leave
   * existing blackouts untouched; send [] to clear them.
   */
  blackouts: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    to:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  })).max(365).optional(),
});

/* ───────────────────────── helpers (read-only) ───────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayISO(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "HH:MM" → minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** UTC day-of-week (0=Sun…6=Sat) for a YYYY-MM-DD date. */
function dowOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function activeSpaceBookings(bookings: BookingRecord[], spaceId: string): BookingRecord[] {
  return bookings.filter(
    (b) =>
      b.itemKind === 'SPACE' &&
      b.itemId === spaceId &&
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED',
  );
}

interface SpaceHours {
  workingDays: number[];
  openMins: number;
  closeMins: number;
  capacity: number;
  /** Full-day blocked dates: legacy unavailableDates ∪ whole-day blackouts. */
  blocked: Set<string>;
  /** Time-range blackouts grouped by date (minutes since midnight). */
  partials: Map<string, { from: number; to: number }[]>;
}

function spaceHours(space: SpaceRecord): SpaceHours {
  const blocked = new Set(space.unavailableDates ?? []);
  const partials = new Map<string, { from: number; to: number }[]>();
  for (const b of space.blackouts ?? []) {
    if (!b.from || !b.to) {
      blocked.add(b.date);
    } else {
      const arr = partials.get(b.date) ?? [];
      arr.push({ from: timeToMinutes(b.from), to: timeToMinutes(b.to) });
      partials.set(b.date, arr);
    }
  }
  return {
    workingDays: space.workingDays ?? [1, 2, 3, 4, 5],
    openMins: timeToMinutes(space.openingTime ?? '09:00'),
    closeMins: timeToMinutes(space.closingTime ?? '18:00'),
    capacity: space.capacity ?? 1,
    blocked,
    partials,
  };
}

/** Concurrent active bookings overlapping the absolute window [startMs, endMs). */
function concurrentCount(bookings: BookingRecord[], startMs: number, endMs: number): number {
  let n = 0;
  for (const b of bookings) {
    const bStart = Date.parse(b.startsAt);
    const bEnd = Date.parse(b.endsAt);
    if (startMs < bEnd && endMs > bStart) n++;
  }
  return n;
}

/** True when [m, m+60) on `date` falls within any time-range blackout. */
function inPartialBlackout(date: string, m: number, hours: SpaceHours): boolean {
  for (const p of hours.partials.get(date) ?? []) {
    if (m < p.to && m + 60 > p.from) return true;
  }
  return false;
}

/** Hourly blocks for one day, each marked available iff a booking would be accepted. */
function buildDaySlots(date: string, hours: SpaceHours, active: BookingRecord[]): DaySlot[] {
  const slots: DaySlot[] = [];
  const isWorkingDay = hours.workingDays.includes(dowOf(date));
  const isBlocked = hours.blocked.has(date);
  const isPast = date < todayISO();
  for (let m = hours.openMins; m + 60 <= hours.closeMins; m += 60) {
    const start = minutesToTime(m);
    const end = minutesToTime(m + 60);
    const startMs = Date.parse(`${date}T${start}:00.000Z`);
    const endMs = Date.parse(`${date}T${end}:00.000Z`);
    const taken = concurrentCount(active, startMs, endMs);
    slots.push({
      start,
      end,
      available:
        isWorkingDay && !isBlocked && !isPast &&
        !inPartialBlackout(date, m, hours) &&
        taken < hours.capacity,
    });
  }
  return slots;
}

/** Peak concurrent occupancy across `date`'s working hours (for "desks left"). */
function peakOccupancy(date: string, hours: SpaceHours, active: BookingRecord[]): number {
  let peak = 0;
  for (let m = hours.openMins; m + 60 <= hours.closeMins; m += 60) {
    const startMs = Date.parse(`${date}T${minutesToTime(m)}:00.000Z`);
    const endMs = Date.parse(`${date}T${minutesToTime(m + 60)}:00.000Z`);
    const taken = concurrentCount(active, startMs, endMs);
    if (taken > peak) peak = taken;
  }
  return peak;
}

/** True when EVERY hour block of `date` is saturated to capacity (no bookable time). */
function isDayFullyBooked(date: string, hours: SpaceHours, active: BookingRecord[]): boolean {
  let hadBlock = false;
  for (let m = hours.openMins; m + 60 <= hours.closeMins; m += 60) {
    hadBlock = true;
    const startMs = Date.parse(`${date}T${minutesToTime(m)}:00.000Z`);
    const endMs = Date.parse(`${date}T${minutesToTime(m + 60)}:00.000Z`);
    if (concurrentCount(active, startMs, endMs) < hours.capacity) return false;
  }
  return hadBlock;
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${pad2(i + 1)}`);
}

/* ─────────────────────────────── GET ─────────────────────────────── */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await db.read();
  const space = (data.spaces ?? []).find((s) => s.id === id);
  if (!space) return jsonError(404, 'NOT_FOUND', 'Space not found');

  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');
  const dateParam = url.searchParams.get('date');
  const unavailableDates = space.unavailableDates ?? [];

  // ── Per-day hourly slots ──────────────────────────────────────────
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const hours = spaceHours(space);
    const active = activeSpaceBookings(data.bookings ?? [], id);
    return json({ slots: buildDaySlots(dateParam, hours, active) });
  }

  // ── Month overview (selectable / blocked / fully-booked) ──────────
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const hours = spaceHours(space);
    const active = activeSpaceBookings(data.bookings ?? [], id);
    const today = todayISO();

    const availableDates: string[] = [];
    const fullyBookedDates: string[] = [];
    const remainingByDate: Record<string, number> = {};
    for (const date of daysInMonth(monthParam)) {
      if (date < today) continue;
      if (!hours.workingDays.includes(dowOf(date))) continue;
      if (hours.blocked.has(date)) continue;
      // Desks still free that day (capacity − peak concurrent occupancy).
      remainingByDate[date] = Math.max(0, hours.capacity - peakOccupancy(date, hours, active));
      if (isDayFullyBooked(date, hours, active)) {
        fullyBookedDates.push(date);
        continue;
      }
      availableDates.push(date);
    }

    // Manually-blocked full-day dates in this month (incubator blackouts) — kept
    // distinct from fully-booked so the editor can render them differently.
    const blockedDates = [...hours.blocked].filter((d) => d.startsWith(`${monthParam}-`)).sort();
    const partialBlackouts = (space.blackouts ?? [])
      .filter((b) => b.from && b.to && b.date.startsWith(`${monthParam}-`));
    return json({
      availableDates,
      // Legacy merged shape (blocked ∪ fully-booked) — unchanged for the public scheduler.
      unavailableDates: [...new Set([...blockedDates, ...fullyBookedDates])].sort(),
      blockedDates,
      fullyBookedDates,
      partialBlackouts,
      remainingByDate,
      workingDays: hours.workingDays,
      openingTime: space.openingTime ?? '09:00',
      closingTime: space.closingTime ?? '18:00',
      capacity: hours.capacity,
    });
  }

  // ── Default shape: full raw block config (the editor loads this before
  //    editing, then PUTs the complete replacement set) ───────────────
  return json({ unavailableDates, blackouts: space.blackouts ?? [] });
}

/* ─────────────────────────────── PUT ─────────────────────────────── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = putSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === id);
    if (!space) return null;

    // Incubator managers can only manage their own spaces
    if (guard.user.role !== 'ADMIN') {
      const incubator = d.incubators.find((i) => i.id === space.incubatorId);
      if (!incubator || incubator.managerId !== guard.user.id) return 'FORBIDDEN';
    }

    // Deduplicate and sort full-day blocks.
    space.unavailableDates = [...new Set(input.unavailableDates)].sort();
    // Replace time-range blackouts when provided (omit field = leave untouched).
    if (input.blackouts !== undefined) {
      space.blackouts = input.blackouts
        .filter((b) => b.from && b.to) // whole-day blocks live in unavailableDates
        .map((b) => ({ date: b.date, from: b.from!, to: b.to! }));
    }
    space.updatedAt = new Date().toISOString();
    return space;
  });

  if (result === null) return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'You do not manage this space');

  return json({
    unavailableDates: result.unavailableDates ?? [],
    blackouts: result.blackouts ?? [],
  });
}
