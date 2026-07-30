/**
 * POST /api/webhooks/payments/:provider
 *
 * Generic provider-callback endpoint. Looks the provider up in the
 * registry, asks it to verify the request signature + parse the body
 * into a canonical event, then settles the matching top-up.
 *
 * Returns 200 only when settlement succeeds (or is replayed) so the
 * provider doesn't keep retrying. Returns 401 on bad signature, 422 on
 * malformed payload, 404 on unknown intent.
 */
import type { NextRequest } from 'next/server';
import { getProviderByCode } from '@/server/payments/registry';
import { ProviderError } from '@/server/payments/errors';
import { dispatchWebhookSettlement } from '@/server/payments/settle-dispatch';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerCode } = await params;
  const provider = getProviderByCode(providerCode);
  if (!provider) {
    return jsonError(404, 'PROVIDER_NOT_FOUND', `Unknown provider: ${providerCode}`);
  }

  const rawBody = await req.text();
  let event;
  try {
    event = await provider.verifyWebhook({
      rawBody,
      headers: req.headers,
      provider: providerCode,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      return jsonError(503, err.code, err.message);
    }
    throw err;
  }

  if (!event) {
    return jsonError(401, 'INVALID_WEBHOOK', 'Signature or payload rejected');
  }

  // Shared with the Stripe webhook route — see settle-dispatch.ts.
  const result = await dispatchWebhookSettlement(event);
  if (!result.matched) {
    return jsonError(404, 'INTENT_NOT_FOUND', 'No matching top-up or booking');
  }
  return json({ kind: result.kind, ...result.payload });
}
