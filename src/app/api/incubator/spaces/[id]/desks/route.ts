/**
 * Incubator desk-calendar API for a single COWORKING space.
 *
 *   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD  → desk grid for the date window
 *   POST   { deskName, date }             → manually BLOCK a desk for a day
 *   DELETE { bookingId }                  → UNBLOCK (cancel an offline block)
 *
 * Availability is computed ONLY via the canonical module
 * (`src/server/spaces/availability.ts`) so this view can never disagree with the
 * booking gate. Block creation re-checks availability inside the db.update
 * critical section (race-free) using the module's pure predicate.
 *
 * This route manages OFFLINE incubator blocks only; online bookings show as
 * taken but are not cancellable here.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type DeskBookingRecord } from '@/server/db/store';
import {
  isDeskFreeInRange,
  listDeskBookingsForDay,
} from '@/server/spaces/availability';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive list of "YYYY-MM-DD" from `from` to `to` (capped at 31 days). */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out;
  for (let ms = start, i = 0; ms <= end && i < 31; ms += 86_400_000, i++) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? today;
  const toParam = url.searchParams.get('to');
  // Default window: 7 days from `from`.
  const to = toParam ?? new Date(Date.parse(`${from}T00:00:00.000Z`) + 6 * 86_400_000)
    .toISOString().slice(0, 10);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return jsonError(400, 'INVALID_RANGE', 'from/to must be YYYY-MM-DD');
  }

  const data = await db.read();
  const space = (data.spaces ?? []).find((s) => s.id === id);
  if (!space) return jsonError(404, 'NOT_FOUND', 'Space not found');
  const incubator = data.incubators.find((i) => i.id === space.incubatorId);
  if (!incubator || (guard.user.role !== 'ADMIN' && incubator.managerId !== guard.user.id)) {
    return jsonError(403, 'FORBIDDEN', 'Not your space');
  }

  const deskNames = space.deskNames ?? [];
  const dates = dateRange(from, to);
  const all = data.deskBookings ?? [];

  // Per-day → per-desk active booking (offline block preferred so unblock can
  // target it). Built via the module's day lookup so overlap rules match.
  const grid = deskNames.map((name) => ({
    deskName: name,
    cells: dates.map((date) => {
      const dayBookings = listDeskBookingsForDay(all, id, date).filter((b) => b.deskName === name);
      const chosen = dayBookings.find((b) => b.source === 'offline') ?? dayBookings[0] ?? null;
      return chosen
        ? {
            date,
            booked: true,
            bookingId: chosen.id,
            source: chosen.source,
            clientName: chosen.clientName ?? null,
          }
        : { date, booked: false, bookingId: null, source: null, clientName: null };
    }),
  }));

  return json({ spaceId: id, from, to, dates, deskNames, grid });
}

const blockSchema = z.object({
  deskName: z.string().min(1).max(60),
  date: z.string().regex(ISO_DATE),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = blockSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  let conflictMsg: string | null = null;
  const result = await db.update<DeskBookingRecord | 'NOT_FOUND' | 'FORBIDDEN' | 'UNKNOWN_DESK' | 'TAKEN'>((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === id);
    if (!space) return 'NOT_FOUND';
    const incubator = d.incubators.find((i) => i.id === space.incubatorId);
    if (!incubator || (guard.user.role !== 'ADMIN' && incubator.managerId !== guard.user.id)) return 'FORBIDDEN';
    if (!(space.deskNames ?? []).includes(input.deskName)) return 'UNKNOWN_DESK';

    if (!Array.isArray(d.deskBookings)) d.deskBookings = [];
    // Race-free re-check inside the critical section via the canonical predicate.
    if (!isDeskFreeInRange(d.deskBookings, id, input.deskName, input.date, input.date)) {
      conflictMsg = 'That desk is already booked for this date';
      return 'TAKEN';
    }

    const rec: DeskBookingRecord = {
      id: randomUUID(),
      spaceId: id,
      incubatorId: space.incubatorId,
      deskName: input.deskName,
      unit: 'DAY',
      date: input.date,
      userId: null,
      clientName: null,
      clientPhone: null,
      status: 'CONFIRMED',
      source: 'offline',
      bookingId: null,
      expiryReminderSentAt: null,
      createdAt: new Date().toISOString(),
    };
    d.deskBookings.push(rec);
    return rec;
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your space');
  if (result === 'UNKNOWN_DESK') return jsonError(400, 'UNKNOWN_DESK', 'No such desk on this space');
  if (result === 'TAKEN') return jsonError(409, 'TAKEN', conflictMsg ?? 'Desk already booked');
  return json(result, { status: 201 });
}

const unblockSchema = z.object({ bookingId: z.string().min(1) });

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }
  let input;
  try { input = unblockSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update<'OK' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_OFFLINE'>((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === id);
    if (!space) return 'NOT_FOUND';
    const incubator = d.incubators.find((i) => i.id === space.incubatorId);
    if (!incubator || (guard.user.role !== 'ADMIN' && incubator.managerId !== guard.user.id)) return 'FORBIDDEN';
    const booking = (d.deskBookings ?? []).find((b) => b.id === input.bookingId && b.spaceId === id);
    if (!booking) return 'NOT_FOUND';
    // Only offline (incubator-created) blocks can be released here.
    if (booking.source !== 'offline') return 'NOT_OFFLINE';
    booking.status = 'CANCELLED';
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Booking not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your space');
  if (result === 'NOT_OFFLINE') return jsonError(400, 'NOT_OFFLINE', 'Only manual blocks can be removed here');
  return json({ ok: true });
}
