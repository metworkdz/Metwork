/**
 * POST /api/incubator/manual-bookings
 *
 * Creates an offline / manually-entered booking on behalf of a client
 * who may not have a Metwork account. The booking is auto-CONFIRMED with
 * source='offline' and paymentMethod='manual'. No wallet transactions occur.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type ClientRecord, type SpaceRecord } from '@/server/db/store';
import { checkSpaceAvailability } from '@/server/bookings/availability';
import { holdDeskForBooking } from '@/server/spaces/availability';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual bookings accept date-only ("YYYY-MM-DD") or full ISO inputs, and the
 * form sends endsAt = startsAt when no end is entered. Build a positive-length
 * [startsAt, endsAt) window so the availability check sees the real footprint
 * (a date-only DAY booking occupies the whole day; quantity drives the span).
 */
function normalizeBookingWindow(
  startsAt: string,
  endsAt: string,
  unit: 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH',
  quantity: number,
): { startsAt: string; endsAt: string } {
  const toMs = (v: string) => Date.parse(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  const startMs = toMs(startsAt);
  let endMs = toMs(endsAt);
  if (!Number.isFinite(startMs)) return { startsAt, endsAt };
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    const qty = Math.max(1, quantity);
    if (unit === 'HOUR') endMs = startMs + qty * 3_600_000;
    else if (unit === 'HALF_DAY') endMs = startMs + 4 * 3_600_000; // default 4h block when no explicit end
    else if (unit === 'DAY') endMs = startMs + qty * 86_400_000;
    else {
      const e = new Date(startMs);
      e.setUTCMonth(e.getUTCMonth() + qty);
      endMs = e.getTime();
    }
  }
  return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() };
}

const bodySchema = z.object({
  itemKind: z.enum(['SPACE', 'PROGRAM']),
  itemId: z.string().min(1),
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().min(1).max(50),
  clientEmail: z.string().email().nullable().optional(),
  clientIdNumber: z.string().max(100).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  unit: z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
  quantity: z.number().int().min(1).max(1000),
  totalAmount: z.number().int().min(0).default(0),
  /**
   * Desk / office identifier — REQUIRED (enforced below) when the SPACE is
   * category COWORKING (must match a name in space.deskNames) or PRIVATE_OFFICE
   * (the single office unit). Ignored for DOMICILIATION / other categories.
   */
  deskName: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = bodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const incubator = d.incubators.find((i) => i.managerId === guard.user.id);
    if (!incubator) return 'NO_INCUBATOR' as const;

    let itemName = '';
    let city = '';
    // The resolved SPACE record (when itemKind === 'SPACE'), captured so the
    // desk/office hold below can read its category + deskNames.
    let spaceForDesk: SpaceRecord | null = null;
    // The window actually persisted on the booking. A SPACE booking is stored as
    // the NORMALIZED [startsAt, endsAt) it was validated against — never the raw
    // date-only input — so the slot it holds is visible to every reader (the
    // public calendar and the next overlap check). Persisting the raw zero-length
    // input was the root cause of manual bookings not blocking the calendar.
    let startsAt = input.startsAt;
    let endsAt = input.endsAt;

    if (input.itemKind === 'SPACE') {
      const space = (d.spaces ?? []).find((s) => s.id === input.itemId && s.incubatorId === incubator.id);
      if (!space) return 'ITEM_NOT_FOUND' as const;
      // Shared availability gate — blackouts + capacity-aware occupancy. Manual
      // bookings get NO blackout bypass; the incubator unblocks the date first.
      const win = normalizeBookingWindow(input.startsAt, input.endsAt, input.unit, input.quantity);
      startsAt = win.startsAt;
      endsAt = win.endsAt;
      const avail = checkSpaceAvailability({
        space,
        bookings: d.bookings,
        spaceId: space.id,
        unit: input.unit,
        startsAt,
        endsAt,
      });
      if (!avail.ok) return avail.reason;
      itemName = space.name;
      city = space.city;
      spaceForDesk = space;
    } else {
      const program = (d.programs ?? []).find((p) => p.id === input.itemId && p.incubatorId === incubator.id);
      if (!program) return 'ITEM_NOT_FOUND' as const;
      // Overbooking guard
      const taken = d.bookings.filter(
        (b) => b.itemKind === 'PROGRAM' && b.itemId === input.itemId &&
               b.status !== 'CANCELLED' && b.status !== 'REFUNDED',
      ).length;
      if (taken >= program.seatsTotal) return 'PROGRAM_FULL' as const;
      itemName = program.title;
      city = program.city;
    }

    // Idempotency: a retried submit (same item, persisted window, client name +
    // amount) must not create a duplicate offline booking. Return the existing
    // one — safe to replay. Mirrors the dedup in /api/incubator/bookings.
    const dupNameKey = input.clientName.trim().toLowerCase();
    const duplicate = d.bookings.find(
      (b) =>
        b.source === 'offline' &&
        b.itemKind === input.itemKind &&
        b.itemId === input.itemId &&
        b.startsAt === startsAt &&
        b.endsAt === endsAt &&
        b.totalAmount === input.totalAmount &&
        (b.clientName ?? '').trim().toLowerCase() === dupNameKey &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    );
    if (duplicate) {
      return {
        ...duplicate,
        customerName: duplicate.clientName ?? input.clientName,
        customerEmail: duplicate.clientEmail ?? '',
        customerPhone: duplicate.clientPhone ?? input.clientPhone,
      };
    }

    // Pre-mint the booking id so the desk hold can link back to it (and so the
    // hold + booking share one identity) before either is persisted.
    const bookingId = randomUUID();

    // ── Category-specific desk / office hold ─────────────────────────────
    // COWORKING desks and PRIVATE_OFFICE units physically occupy space, so a
    // manual booking MUST block the availability calendar — otherwise a public
    // user could still book a desk that is already occupied. Written atomically
    // with the BookingRecord below via the canonical writer: a conflict returns
    // BEFORE the client/booking are persisted, so nothing is half-written.
    if (spaceForDesk) {
      const category = (spaceForDesk as SpaceRecord).category;
      if (category === 'COWORKING' || category === 'PRIVATE_OFFICE') {
        const deskName = input.deskName?.trim();
        if (!deskName) return 'DESK_REQUIRED' as const;
        if (category === 'COWORKING' && !((spaceForDesk as SpaceRecord).deskNames ?? []).includes(deskName)) {
          return 'UNKNOWN_DESK' as const;
        }
        if (!Array.isArray(d.deskBookings)) d.deskBookings = [];
        const hold = holdDeskForBooking(d.deskBookings, {
          spaceId: (spaceForDesk as SpaceRecord).id,
          incubatorId: incubator.id,
          deskName,
          startsAt,
          endsAt,
          userId: null,
          clientName: input.clientName,
          clientPhone: input.clientPhone,
          bookingId,
          source: 'offline',
        });
        if (!hold.ok) {
          // Structured conflict carried out of the closure so the 409 can name
          // the exact desk + day that was already taken.
          return { __deskConflict: { deskName, date: hold.conflictDate } } as const;
        }
      }
    }

    const now = new Date().toISOString();

    // Find-or-create the client record so this offline booking shows up in
    // the incubator's CRM dashboard.  Match case-insensitively on name + phone
    // (or name + email when no phone) within this incubator's scope.
    if (!Array.isArray(d.clients)) d.clients = [];
    const nameKey  = input.clientName.trim().toLowerCase();
    const phoneKey = input.clientPhone.trim().toLowerCase();
    const emailKey = (input.clientEmail ?? '').trim().toLowerCase();
    let client = d.clients.find((c) => {
      if (c.incubatorId !== incubator.id) return false;
      if (c.fullName.trim().toLowerCase() !== nameKey) return false;
      if (phoneKey) return c.phone.trim().toLowerCase() === phoneKey;
      if (emailKey) return c.email.trim().toLowerCase() === emailKey;
      return false;
    });
    if (!client) {
      const newClient: ClientRecord = {
        id:           randomUUID(),
        incubatorId:  incubator.id,
        fullName:     input.clientName.trim(),
        phone:        input.clientPhone.trim(),
        email:        input.clientEmail ?? '',
        idCardNumber: input.clientIdNumber ?? null,
        companyName:  null,
        notes:        null,
        createdAt:    now,
        updatedAt:    now,
      };
      d.clients.push(newClient);
      client = newClient;
    }

    const booking = {
      id: bookingId,
      userId: null,
      source: 'offline' as const,
      paymentMethod: 'manual' as const,
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      clientEmail: input.clientEmail ?? null,
      clientIdNumber: input.clientIdNumber ?? null,
      itemKind: input.itemKind,
      itemId: input.itemId,
      itemName,
      vendorName: incubator.name,
      city,
      unit: input.unit,
      quantity: input.quantity,
      startsAt,
      endsAt,
      totalAmount: input.totalAmount,
      status: 'CONFIRMED' as const,
      clientReference: `manual-${randomUUID().slice(0, 8)}`,
      transactionId: null,
      createdAt: now,
      updatedAt: now,
    };

    d.bookings.push(booking);

    return {
      ...booking,
      customerName: input.clientName,
      customerEmail: input.clientEmail ?? '',
      customerPhone: input.clientPhone,
    };
  });

  if (result === 'NO_INCUBATOR') return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');
  if (result === 'ITEM_NOT_FOUND') return jsonError(404, 'ITEM_NOT_FOUND', 'Space or program not found');
  if (result === 'PROGRAM_FULL') return jsonError(409, 'PROGRAM_FULL', 'Program has no remaining seats');
  if (result === 'DATE_UNAVAILABLE') return jsonError(409, 'DATE_UNAVAILABLE', 'This date is blocked. Unblock it in the availability calendar first.');
  if (result === 'OVERLAP_CONFLICT') return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked');
  if (result === 'CAPACITY_EXCEEDED') return jsonError(409, 'CAPACITY_EXCEEDED', 'No capacity left for this slot');
  if (result === 'DESK_REQUIRED') return jsonError(422, 'DESK_REQUIRED', 'Select a desk / office for this space');
  if (result === 'UNKNOWN_DESK') return jsonError(422, 'UNKNOWN_DESK', 'No such desk on this space');
  if (typeof result === 'object' && result !== null && '__deskConflict' in result) {
    // Structured 409 so the form can point at the exact desk + day.
    const c = result.__deskConflict;
    if (c) return json({ error: 'DESK_ALREADY_BOOKED', deskName: c.deskName, date: c.date }, { status: 409 });
  }

  return json({ booking: result }, { status: 201 });
}
