/**
 * GET  /api/incubator/payment-links  — list this incubator's payment links
 * POST /api/incubator/payment-links  — create a new payment link
 *
 * Incubator-only. The link lets a client pay WITHOUT a Metwork account via the
 * public /pay/<slug> page. Amount is the base the incubator invoices; the payer
 * fee is added on top at payment time and the receiver commission follows the
 * incubator's subscription plan (central commission engine).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import {
  createPaymentLink,
  listPaymentLinks,
} from '@/server/payments/payment-links';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    serviceName: z.string().trim().min(2).max(120),
    amount: z.number().int().min(50).max(50_000_000),
    description: z.string().trim().max(2000).optional().nullable(),
    hasExpiry: z.boolean().default(false),
    /** ISO datetime — required + must be in the future when hasExpiry is on. */
    expiresAt: z.string().datetime().optional().nullable(),
  })
  .refine(
    (d) => !d.hasExpiry || (typeof d.expiresAt === 'string' && Date.parse(d.expiresAt) > Date.now()),
    { message: 'A future expiry date is required when expiry is enabled', path: ['expiresAt'] },
  );

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const items = await listPaymentLinks(inc.id);
  return json({ items, total: items.length });
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
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const record = await createPaymentLink({
    incubatorId: inc.id,
    serviceName: input.serviceName,
    amount: input.amount,
    description: input.description ?? null,
    hasExpiry: input.hasExpiry,
    expiresAt: input.hasExpiry ? input.expiresAt ?? null : null,
  });

  return json(record, { status: 201 });
}
