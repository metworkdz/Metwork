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
import { db, type ClientRecord } from '@/server/db/store';
import { checkSpaceAvailability } from '@/server/bookings/availability';
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

    if (input.itemKind === 'SPACE') {
      const space = (d.spaces ?? []).find((s) => s.id === input.itemId && s.incubatorId === incubator.id);
      if (!space) return 'ITEM_NOT_FOUND' as const;
      // Shared availability gate — blackouts + capacity-aware occupancy. Manual
      // bookings get NO blackout bypass; the incubator unblocks the date first.
      const win = normalizeBookingWindow(input.startsAt, input.endsAt, input.unit, input.quantity);
      const avail = checkSpaceAvailability({
        space,
        bookings: d.bookings,
        spaceId: space.id,
        unit: input.unit,
        startsAt: win.startsAt,
        endsAt: win.endsAt,
      });
      if (!avail.ok) return avail.reason;
      itemName = space.name;
      city = space.city;
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
      id: randomUUID(),
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
      startsAt: input.startsAt,
      endsAt: input.endsAt,
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

  return json({ booking: result }, { status: 201 });
}
