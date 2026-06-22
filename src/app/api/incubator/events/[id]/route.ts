/**
 * PATCH  /api/incubator/events/:id  — update an event
 * DELETE /api/incubator/events/:id  — delete an event
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { validateCashDeposit, normalizeDepositConfig } from '@/server/bookings/listing-payment';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  description: z.string().max(2000).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(8).optional(),
  price: z.number().int().nonnegative().optional(),
  onlinePrice: z.number().int().nonnegative().nullable().optional(),
  cashPrice: z.number().int().nonnegative().nullable().optional(),
  isOnline: z.boolean().optional(),
  capacity: z.number().int().positive().optional(),
  eventDate: z.string().datetime({ offset: true }).optional(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).optional(),
  cashDepositType:  z.enum(['FIXED', 'PERCENT']).optional().nullable(),
  cashDepositValue: z.number().int().positive().optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
});

async function findIncubator(userId: string) {
  const data = await db.read();
  return data.incubators.find((i) => i.managerId === userId) ?? null;
}

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;

  const incubator = await findIncubator(guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  let depositError: string | null = null;
  const updated = await db.update((d) => {
    const event = (d.events ?? []).find(
      (e) => e.id === id && e.incubatorId === incubator.id,
    );
    if (!event) return null;

    // Payment config: validate against the merged (existing + patched) state so
    // turning CASH on always carries a valid deposit, and turning it off clears
    // the deposit. Only runs when a payment field is actually being changed.
    if (
      input.acceptedPaymentMethods !== undefined ||
      input.cashDepositType !== undefined ||
      input.cashDepositValue !== undefined
    ) {
      const nextMethods = input.acceptedPaymentMethods ?? event.acceptedPaymentMethods ?? ['ONLINE'];
      const nextType  = input.cashDepositType  !== undefined ? input.cashDepositType  : (event.cashDepositType  ?? null);
      const nextValue = input.cashDepositValue !== undefined ? input.cashDepositValue : (event.cashDepositValue ?? null);
      depositError = validateCashDeposit(nextMethods, nextType, nextValue);
      if (depositError) return 'INVALID_DEPOSIT';
      event.acceptedPaymentMethods = nextMethods;
      const cfg = normalizeDepositConfig(nextMethods, nextType, nextValue);
      event.cashDepositType  = cfg.cashDepositType;
      event.cashDepositValue = cfg.cashDepositValue;
    }

    if (input.title !== undefined) event.title = input.title;
    if (input.description !== undefined) event.description = input.description;
    if (input.city !== undefined) event.city = input.city;
    if (input.imageUrl !== undefined) event.imageUrl = input.imageUrl ?? null;
    // imageUrls wins when sent: it's the ordered gallery, cover = imageUrls[0].
    if (input.imageUrls !== undefined) {
      event.imageUrls = input.imageUrls;
      event.imageUrl = input.imageUrls[0] ?? null;
    }
    if (input.price !== undefined) event.price = input.price;
    if (input.onlinePrice !== undefined) event.onlinePrice = input.onlinePrice;
    if (input.cashPrice !== undefined) event.cashPrice = input.cashPrice;
    if (input.isOnline !== undefined) event.isOnline = input.isOnline;
    if (input.capacity !== undefined) event.capacity = input.capacity;
    if (input.eventDate !== undefined) event.eventDate = input.eventDate;
    if (input.status !== undefined) event.isActive = input.status === 'PUBLISHED';
    if (input.slug !== undefined) event.slug = input.slug ?? undefined;
    event.updatedAt = new Date().toISOString();
    return { ...event };
  });

  if (updated === 'INVALID_DEPOSIT') return jsonError(400, 'INVALID_DEPOSIT', depositError ?? 'Invalid cash deposit configuration');
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Event not found');
  return json({ event: updated });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;

  const incubator = await findIncubator(guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  const { id } = await params;

  const deleted = await db.update((d) => {
    const events = d.events ?? [];
    const idx = events.findIndex(
      (e) => e.id === id && e.incubatorId === incubator.id,
    );
    if (idx === -1) return false;
    events.splice(idx, 1);
    return true;
  });

  if (!deleted) return jsonError(404, 'NOT_FOUND', 'Event not found');
  return json({ ok: true });
}
