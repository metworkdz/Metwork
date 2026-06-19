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
import { confirmTopUp } from '@/server/wallet/service';
import { settleCardBookingFromWebhook } from '@/server/bookings/card-payment';
import { settleGuestConsultationFromWebhook } from '@/server/consultations/guest-payment';
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

  // 1. Wallet top-up intent (id = TopUpIntent id). Covers direct top-ups and
  //    the member instant-book shortfall top-up.
  const settle = await confirmTopUp({
    topUpId: event.topUpId,
    providerRef: event.providerRef,
    status: event.status,
  });
  if (settle.ok) {
    return json({
      kind: 'topup',
      topUpId: event.topUpId,
      status: settle.finalStatus,
      replayed: settle.replayed,
    });
  }

  // 2. Not a top-up intent — the external_id may be a card booking or a guest
  //    consultation (both pass booking.id as the provider id). The webhook is
  //    signature-verified, so settle directly (idempotent). This is the only
  //    path that recovers a payer who never returns to the pay page.
  const card = await settleCardBookingFromWebhook(event.topUpId, event.providerRef, event.status);
  if (card === 'SETTLED' || card === 'ALREADY') {
    return json({ kind: 'card_booking', id: event.topUpId, result: card });
  }

  const guest = await settleGuestConsultationFromWebhook(event.topUpId, event.providerRef, event.status);
  if (guest === 'SETTLED' || guest === 'ALREADY') {
    return json({ kind: 'guest_consultation', id: event.topUpId, result: guest });
  }

  // A FAILED event for a booking (status IGNORED) is acknowledged so the
  // provider stops retrying; only a genuinely unknown id is a 404.
  if (card === 'IGNORED' || guest === 'IGNORED') {
    return json({ kind: 'ignored', id: event.topUpId });
  }

  return jsonError(404, 'INTENT_NOT_FOUND', 'No matching top-up or booking');
}
