/**
 * GET /api/incubator/bookings  — list all bookings for this incubator's listings
 * POST /api/incubator/bookings — create a manual (offline) booking for a space
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type BookingRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendBookingReceiptEmail } from '@/server/notifications/mock';

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
  unit:            z.enum(['HOUR', 'DAY', 'MONTH']),
  totalAmount:     z.number().int().min(0),
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
      const user = userMap.get(b.userId);
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
        customerName:    user?.fullName ?? 'Unknown',
        customerEmail:   user?.email    ?? '',
      };
    });

  return json({ items, total: items.length });
}

/* ── POST — manual offline booking ── */
export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
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

    // Overlap check against active bookings for this space
    const newStart = new Date(input.startsAt).getTime();
    const newEnd   = new Date(input.endsAt).getTime();
    const conflict = d.bookings.find((b) => {
      if (b.itemKind !== 'SPACE' || b.itemId !== space.id) return false;
      if (b.status === 'CANCELLED' || b.status === 'REFUNDED') return false;
      const bStart = new Date(b.startsAt).getTime();
      const bEnd   = new Date(b.endsAt).getTime();
      return newStart < bEnd && newEnd > bStart;
    });
    if (conflict) return { ok: false, reason: 'OVERLAP_CONFLICT' };

    // Compute quantity from range
    const diffMs = newEnd - newStart;
    let quantity: number;
    switch (input.unit) {
      case 'HOUR':  quantity = Math.max(1, Math.ceil(diffMs / 3_600_000)); break;
      case 'DAY':   quantity = Math.max(1, Math.ceil(diffMs / 86_400_000)); break;
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
      userId:          guard.user.id,  // incubator user ID as owner
      itemKind:        'SPACE',
      itemId:          space.id,
      itemName:        space.name,
      vendorName:      inc.name,
      city:            space.city,
      unit:            input.unit,
      quantity,
      startsAt:        input.startsAt,
      endsAt:          input.endsAt,
      totalAmount:     input.totalAmount,
      status:          'CONFIRMED',
      clientReference: randomUUID(),   // generated for manual bookings
      transactionId:   null,
      paymentMethod:   input.paymentMethod === 'ONLINE' ? 'ONLINE' : 'CASH',
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
    return jsonError(400, 'BAD_REQUEST', result.reason);
  }

  // Send PDF receipt to the client if an email was supplied
  if (input.clientEmail) {
    sendBookingReceiptEmail({
      booking:     result.booking,
      clientName:  input.clientName,
      clientEmail: input.clientEmail,
      incubator:   inc,
      lang:        'fr',   // manual bookings default to French (Algeria)
    });
  }

  return json(result.booking, { status: 201 });
}
