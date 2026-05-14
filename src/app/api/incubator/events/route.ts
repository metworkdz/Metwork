/**
 * GET  /api/incubator/events  — list this incubator's events
 * POST /api/incubator/events  — create a new event
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type EventRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { listEventsByIncubator } from '@/server/bookings/event-catalog';
import { fromZod, json, jsonError } from '@/server/http/json';
import { slugify, uniqueSlug } from '@/lib/slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createEventSchema = z.object({
  title:       z.string().min(2).max(120),
  description: z.string().min(10).max(2000),
  city:        z.string().min(1).max(80),
  imageUrl:    z.string().url().optional().nullable(),
  price:       z.number().int().min(0),
  isOnline:    z.boolean().default(false),
  capacity:    z.number().int().min(1).max(100_000),
  eventDate:   z.string().datetime(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).default(['ONLINE', 'CASH']),
  slug:        z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
});

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const events = await listEventsByIncubator(inc.id);
  return json({ items: events, total: events.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createEventSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const paymentMethods: ('ONLINE' | 'CASH')[] =
    inc.subscriptionCode === 'COMMISSION' ? ['ONLINE'] : input.acceptedPaymentMethods;

  const now = new Date().toISOString();
  const record = await db.update<EventRecord>((d) => {
    if (!Array.isArray(d.events)) d.events = [];
    const existingSlugs = d.events
      .filter((e) => e.incubatorId === inc.id && e.slug)
      .map((e) => e.slug as string);
    const baseSlug = input.slug ? input.slug : slugify(input.title.trim());
    const slug = uniqueSlug(baseSlug, existingSlugs);

    const ev: EventRecord = {
      id:                     randomUUID(),
      incubatorId:            inc.id,
      incubatorName:          inc.name,
      title:                  input.title.trim(),
      description:            input.description.trim(),
      city:                   input.city.trim(),
      imageUrl:               input.imageUrl ?? null,
      price:                  input.price,
      isOnline:               input.isOnline,
      capacity:               input.capacity,
      eventDate:              input.eventDate,
      acceptedPaymentMethods: paymentMethods,
      isActive:               true,
      slug,
      createdAt:              now,
      updatedAt:              now,
    };
    d.events.push(ev);
    return ev;
  });

  return json(record, { status: 201 });
}
