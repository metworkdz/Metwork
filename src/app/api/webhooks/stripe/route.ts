/**
 * POST /api/webhooks/stripe
 *
 * Stripe's callback endpoint. Stripe is the SOURCE OF TRUTH for whether an
 * international-card consultation was paid — the browser redirect is never
 * trusted, and the return page's poll is only a UX fallback.
 *
 * Why a dedicated route rather than /api/webhooks/payments/stripe: signature
 * verification needs the byte-exact raw body, and Stripe's header/secret
 * semantics differ from the generic provider contract. Settlement itself is
 * NOT duplicated — it goes through the same `dispatchWebhookSettlement` as
 * every other provider, so a Stripe-paid consultation settles through exactly
 * the same code as a CIB one.
 *
 * Idempotency: Stripe retries until it gets a 2xx and may deliver the same
 * event more than once. Every settler claims its transition inside a single
 * store mutation, so a replay is a no-op — it cannot double-create a booking
 * or double-credit a consultant.
 */
import type { NextRequest } from 'next/server';
import { verifyStripeWebhook } from '@/server/payments/stripe-provider';
import { ProviderError } from '@/server/payments/errors';
import { dispatchWebhookSettlement } from '@/server/payments/settle-dispatch';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Raw text, not req.json() — any re-serialisation breaks the signature.
  const rawBody = await req.text();

  let outcome;
  try {
    outcome = await verifyStripeWebhook({
      rawBody,
      headers: req.headers,
      provider: 'stripe',
    });
  } catch (err) {
    // Missing keys → 503 so Stripe retries once we're configured, rather than
    // silently dropping a real payment.
    if (err instanceof ProviderError) return jsonError(503, err.code, err.message);
    throw err;
  }

  // Missing or forged signature — never reaches settlement, no dev bypass.
  if (!outcome.authentic) {
    return jsonError(401, 'INVALID_WEBHOOK', 'Signature rejected');
  }
  // Authentic but not an event we settle on (e.g. checkout.session.expired).
  // Acknowledge with 200 so Stripe stops retrying it.
  if (!outcome.event) {
    return json({ kind: 'ignored' });
  }

  const result = await dispatchWebhookSettlement(outcome.event);
  if (!result.matched) {
    return jsonError(404, 'INTENT_NOT_FOUND', 'No matching top-up or booking');
  }
  return json({ kind: result.kind, ...result.payload });
}
