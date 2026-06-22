/**
 * GET /api/incubator/bookings  — list all bookings for this incubator's listings
 * POST /api/incubator/bookings — create a manual (offline) booking for a space
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type BookingRecord } from '@/server/db/store';
import { checkSpaceAvailability } from '@/server/bookings/availability';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendBookingReceiptEmailAsync } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const manualBookingSchema = z.object({
  spaceId:         z.string().uuid(),
  /** Client's full name (for offline bookings without a platform account). */
  clientName:      z.string().min(1).max(120),
  /** Optional — when provided, a PDF receipt is emailed to the client. */
  clientEmail:     z.string().email().max(200).optional().nullable(),
  startsAt:        z.string().datetime(),
  endsAt:          z.string().datetime(),
  unit:            z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
  // Accept decimals from the <input type="number"> field; rounded to an integer
  // (DZD) before persisting so a fractional amount never trips validation.
  totalAmount:     z.number().min(0),
  // How the offline payment was collected. Request-only label — the booking
  // record always settles as 'manual' (no wallet/online transaction occurs).
  paymentMethod:   z.enum(['CASH', 'ONLINE', 'OTHER']).default('CASH'),
  notes:           z.string().max(500).optional().nullable(),
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

/* ── GET ── */
export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const data = await db.read();

  const spaceIds   = new Set((data.spaces   ?? []).filter((s) => s.incubatorId === inc.id).map((s) => s.id));
  const programIds = new Set((data.programs ?? []).filter((p) => p.incubatorId === inc.id).map((p) => p.id));
  const eventIds   = new Set((data.events   ?? []).filter((e) => e.incubatorId === inc.id).map((e) => e.id));

  const relevant = data.bookings.filter((b) => {
    if (b.itemKind === 'SPACE'   && spaceIds.has(b.itemId))   return true;
    if (b.itemKind === 'PROGRAM' && programIds.has(b.itemId)) return true;
    if (b.itemKind === 'EVENT'   && eventIds.has(b.itemId))   return true;
    return false;
  });

  const userMap = new Map(data.users.map((u) => [u.id, { fullName: u.fullName, email: u.email }]));

  const items = relevant
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => {
      const user = b.userId ? userMap.get(b.userId) : undefined;
      return {
        id:              b.id,
        itemKind:        b.itemKind,
        itemId:          b.itemId,
        itemName:        b.itemName,
        status:          b.status,
        totalAmount:     b.totalAmount,
        paymentMethod:   b.paymentMethod ?? null,
        startsAt:        b.startsAt,
        endsAt:          b.endsAt,
        createdAt:       b.createdAt,
        clientReference: b.clientReference,
        // Offline bookings carry the client on the record itself (no platform
        // user); online bookings resolve via the user map.
        customerName:    b.clientName  ?? user?.fullName ?? 'Unknown',
        customerEmail:   b.clientEmail ?? user?.email    ?? '',
      };
    });

  return json({ items, total: items.length });
}

/* ── POST — manual offline booking ── */
export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = manualBookingSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update<{ ok: true; booking: BookingRecord } | { ok: false; reason: string }>((d) => {
    // Confirm space belongs to this incubator
    const space = (d.spaces ?? []).find((s) => s.id === input.spaceId && s.incubatorId === inc.id);
    if (!space) return { ok: false, reason: 'SPACE_NOT_FOUND' };

    // Idempotency: a retried submit (same space, window, client + amount) must
    // not create a duplicate offline booking. Return the existing one instead.
    const totalAmount = Math.round(input.totalAmount);
    const clientNameKey = input.clientName.trim().toLowerCase();
    const duplicate = d.bookings.find(
      (b) =>
        b.source === 'offline' &&
        b.itemKind === 'SPACE' &&
        b.itemId === space.id &&
        b.startsAt === input.startsAt &&
        b.endsAt === input.endsAt &&
        b.totalAmount === totalAmount &&
        (b.clientName ?? '').trim().toLowerCase() === clientNameKey &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    );
    if (duplicate) return { ok: true, booking: duplicate };

    // Shared availability gate: blackouts + capacity-aware occupancy. A manual
    // booking gets NO bypass of blackouts — the incubator must unblock the date
    // first (the calendar lets them toggle it).
    const avail = checkSpaceAvailability({
      space,
      bookings: d.bookings,
      spaceId: space.id,
      unit: input.unit,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    if (!avail.ok) return { ok: false, reason: avail.reason };

    // Compute quantity from range
    const diffMs = new Date(input.endsAt).getTime() - new Date(input.startsAt).getTime();
    let quantity: number;
    switch (input.unit) {
      case 'HOUR':     quantity = Math.max(1, Math.ceil(diffMs / 3_600_000)); break;
      case 'HALF_DAY': quantity = 1; break;
      case 'DAY':      quantity = Math.max(1, Math.ceil(diffMs / 86_400_000)); break;
      case 'MONTH': {
        const s = new Date(input.startsAt);
        const e = new Date(input.endsAt);
        quantity = Math.max(1, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()));
        break;
      }
    }

    const now = new Date().toISOString();
    const booking: BookingRecord = {
      id:              randomUUID(),
      // Offline bookings have no platform user — the client may not have an
      // account. Storing the incubator's own id here would mislabel the booking
      // as the manager's own and pollute their personal bookings list.
      userId:          null,
      source:          'offline',
      itemKind:        'SPACE',
      itemId:          space.id,
      itemName:        space.name,
      vendorName:      inc.name,
      city:            space.city,
      unit:            input.unit,
      quantity,
      startsAt:        input.startsAt,
      endsAt:          input.endsAt,
      totalAmount,
      status:          'CONFIRMED',
      clientReference: randomUUID(),   // generated for manual bookings
      transactionId:   null,
      paymentMethod:   'manual',       // offline settlement (cash/online/other label is request-only)
      clientName:      input.clientName.trim(),
      clientEmail:     input.clientEmail ?? null,
      notes:           input.notes ?? null,
      createdAt:       now,
      updatedAt:       now,
    };
    d.bookings.push(booking);
    return { ok: true, booking };
  });

  if (!result.ok) {
    if (result.reason === 'SPACE_NOT_FOUND')
      return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found or does not belong to this incubator');
    if (result.reason === 'OVERLAP_CONFLICT')
      return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked');
    if (result.reason === 'DATE_UNAVAILABLE')
      return jsonError(409, 'DATE_UNAVAILABLE', 'This date is blocked. Unblock it in the availability calendar first.');
    if (result.reason === 'CAPACITY_EXCEEDED')
      return jsonError(409, 'CAPACITY_EXCEEDED', 'No capacity left for this slot');
    return jsonError(400, 'BAD_REQUEST', result.reason);
  }

  // Send PDF receipt to the client if an email was supplied. Awaited (inside a
  // never-throwing helper) so the PDF + email actually completes before the
  // serverless function suspends — the booking is already committed above, so
  // this can only add latency, never roll the booking back.
  if (input.clientEmail) {
    await sendBookingReceiptEmailAsync({
      booking:     result.booking,
      clientName:  input.clientName,
      clientEmail: input.clientEmail,
      incubator:   inc,
      lang:        'fr',   // manual bookings default to French (Algeria)
    });
  }

  return json(result.booking, { status: 201 });
}
