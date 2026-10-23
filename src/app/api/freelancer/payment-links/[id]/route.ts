/**
 * POST /api/freelancer/payment-links/[id] — { action: 'cancel' }. Only an
 * unpaid link of this freelancer's can be cancelled.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { cancelPaymentLink } from '@/server/payments/payment-links';
import { requireInvoicingFreelancer } from '@/server/invoices/freelancer-access';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.literal('cancel') });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireInvoicingFreelancer();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  try { schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const result = await cancelPaymentLink(id, { freelancerId: guard.user.id });
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Payment link not found');
    if (result.reason === 'ORDER_LINK') return jsonError(409, 'ORDER_LINK', 'This link belongs to an order: cancel the order instead');
    return jsonError(409, 'ALREADY_PAID', 'A paid payment link cannot be cancelled');
  }
  return json(result.link);
}
