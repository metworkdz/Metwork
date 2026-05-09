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
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  itemKind: z.enum(['SPACE', 'PROGRAM']),
  itemId: z.string().min(1),
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().min(1).max(50),
  clientEmail: z.string().email().nullable().optional(),
  clientIdNumber: z.string().max(100).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  unit: z.enum(['HOUR', 'DAY', 'MONTH']),
  quantity: z.number().int().min(1).max(1000),
  totalAmount: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
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
      const space = d.incubatorSpaces.find((s) => s.id === input.itemId && s.incubatorId === incubator.id);
      if (!space) return 'ITEM_NOT_FOUND' as const;
      itemName = space.name;
      city = space.city;
    } else {
      const program = d.incubatorPrograms.find((p) => p.id === input.itemId && p.incubatorId === incubator.id);
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

  return json({ booking: result }, { status: 201 });
}
