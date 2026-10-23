/**
 * GET  /api/freelancer/payment-links — this freelancer's payment links
 * POST /api/freelancer/payment-links — create one (DZD only)
 *
 * Same links, same public /pay/<slug> page and same settlement as incubators
 * (`@/server/payments/payment-links`); the base lands in the freelancer's
 * wallet minus their plan's link fee. Free plan: limited active links.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { createPaymentLink, listPaymentLinks } from '@/server/payments/payment-links';
import { freelancerQuotaRefusal, requireInvoicingFreelancer } from '@/server/invoices/freelancer-access';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    serviceName: z.string().trim().min(2).max(120),
    amount: z.number().int().min(50).max(50_000_000),
    description: z.string().trim().max(2000).optional().nullable(),
    hasExpiry: z.boolean().default(false),
    expiresAt: z.string().datetime().optional().nullable(),
  })
  .refine(
    (d) => !d.hasExpiry || (typeof d.expiresAt === 'string' && Date.parse(d.expiresAt) > Date.now()),
    { message: 'A future expiry date is required when expiry is enabled', path: ['expiresAt'] },
  );

export async function GET() {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;
  const items = await listPaymentLinks({ freelancerId: guard.user.id });
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`freelancer-link:${guard.user.id}`, 30, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many links created. Please try again later.');
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const refusal = await freelancerQuotaRefusal(guard.user.id, 'paymentLink');
  if (refusal) return refusal;
  const record = await createPaymentLink({
    freelancerId: guard.user.id,
    serviceName: input.serviceName,
    amount: input.amount,
    description: input.description ?? null,
    hasExpiry: input.hasExpiry,
    expiresAt: input.hasExpiry ? input.expiresAt ?? null : null,
  });
  return json(record, { status: 201 });
}
