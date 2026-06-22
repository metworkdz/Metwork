/**
 * PATCH  /api/incubator/programs/[id]  — update a program
 * DELETE /api/incubator/programs/[id]  — delete a program
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { validateCashDeposit, normalizeDepositConfig } from '@/server/bookings/listing-payment';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Accept either a date-only string (YYYY-MM-DD) or a full ISO datetime, so the
// edit form (which sends ISO datetimes, like the create route) validates the
// same way create does. The refine below still orders the dates correctly
// because all three fields are produced in the same format together.
const isoDate = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isNaN(Date.parse(s)),
    'Must be a valid date (YYYY-MM-DD or ISO 8601)',
  );

const patchSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  description: z.string().max(2000).optional(),
  type: z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP']).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(8).optional(),
  price: z.number().int().nonnegative().optional(),
  onlinePrice: z.number().int().nonnegative().nullable().optional(),
  cashPrice: z.number().int().nonnegative().nullable().optional(),
  seatsTotal: z.number().int().positive().optional(),
  deadline:  isoDate.optional(),
  startDate: isoDate.optional(),
  endDate:   isoDate.optional(),
  acceptedPaymentMethods: z.array(z.enum(['ONLINE', 'CASH'])).min(1).optional(),
  cashDepositType:  z.enum(['FIXED', 'PERCENT']).optional().nullable(),
  cashDepositValue: z.number().int().positive().optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
}).refine(
  (d) => {
    if (d.startDate && d.endDate && d.startDate >= d.endDate) return false;
    if (d.deadline && d.startDate && d.deadline > d.startDate) return false;
    return true;
  },
  { message: 'deadline must be ≤ startDate, and startDate must be < endDate' },
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;
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
  const program = await db.update((d) => {
    const p = (d.programs ?? []).find((x) => x.id === id);
    if (!p) return null;
    const incubator = d.incubators.find((i) => i.id === p.incubatorId);
    if (!incubator || incubator.managerId !== guard.user.id) return 'FORBIDDEN';

    // Payment config: validate against the merged (existing + patched) state so
    // turning CASH on always carries a valid deposit, and turning it off clears
    // the deposit. Only runs when a payment field is actually being changed.
    if (
      input.acceptedPaymentMethods !== undefined ||
      input.cashDepositType !== undefined ||
      input.cashDepositValue !== undefined
    ) {
      const nextMethods = input.acceptedPaymentMethods ?? p.acceptedPaymentMethods ?? ['ONLINE'];
      const nextType  = input.cashDepositType  !== undefined ? input.cashDepositType  : (p.cashDepositType  ?? null);
      const nextValue = input.cashDepositValue !== undefined ? input.cashDepositValue : (p.cashDepositValue ?? null);
      depositError = validateCashDeposit(nextMethods, nextType, nextValue);
      if (depositError) return 'INVALID_DEPOSIT';
      p.acceptedPaymentMethods = nextMethods;
      const cfg = normalizeDepositConfig(nextMethods, nextType, nextValue);
      p.cashDepositType  = cfg.cashDepositType;
      p.cashDepositValue = cfg.cashDepositValue;
    }

    if (input.title !== undefined) p.title = input.title;
    if (input.description !== undefined) p.description = input.description;
    if (input.type !== undefined) p.type = input.type;
    if (input.city !== undefined) p.city = input.city;
    if (input.imageUrl !== undefined) p.imageUrl = input.imageUrl ?? null;
    // imageUrls wins when sent: it's the ordered gallery, cover = imageUrls[0].
    if (input.imageUrls !== undefined) {
      p.imageUrls = input.imageUrls;
      p.imageUrl = input.imageUrls[0] ?? null;
    }
    if (input.price !== undefined) p.price = input.price;
    if (input.onlinePrice !== undefined) p.onlinePrice = input.onlinePrice;
    if (input.cashPrice !== undefined) p.cashPrice = input.cashPrice;
    if (input.seatsTotal !== undefined) p.seatsTotal = input.seatsTotal;
    if (input.deadline !== undefined) p.deadline = input.deadline;
    if (input.startDate !== undefined) p.startDate = input.startDate;
    if (input.endDate !== undefined) p.endDate = input.endDate;
    if (input.status !== undefined) p.isActive = input.status === 'PUBLISHED';
    if (input.slug !== undefined) p.slug = input.slug ?? undefined;
    p.updatedAt = new Date().toISOString();
    return p;
  });

  if (program === null) return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (program === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  if (program === 'INVALID_DEPOSIT') return jsonError(400, 'INVALID_DEPOSIT', depositError ?? 'Invalid cash deposit configuration');
  return json({ program });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const programs = d.programs ?? [];
    const idx = programs.findIndex((x) => x.id === id);
    if (idx === -1) return 'NOT_FOUND';
    const incubator = d.incubators.find((i) => i.id === programs[idx]!.incubatorId);
    if (!incubator || incubator.managerId !== guard.user.id) return 'FORBIDDEN';
    programs.splice(idx, 1);
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  return json({ ok: true });
}
