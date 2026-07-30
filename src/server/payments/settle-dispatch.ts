/**
 * Webhook settlement dispatch — ONE implementation, shared by every provider
 * webhook route.
 *
 * Each money flow hands the provider its own internal id as the callback's
 * `external_id`, so a verified webhook is resolved by asking each settler in
 * turn whether the id is theirs. Every settler is idempotent, which is what
 * makes duplicate delivery (providers retry aggressively) a no-op rather than a
 * double credit.
 *
 * Extracted from /api/webhooks/payments/[provider] so the Stripe route — which
 * needs its own raw-body signature handling but identical settlement — cannot
 * drift from it. Signature verification stays in the routes; by the time this
 * runs the event is already authenticated.
 */
import { confirmTopUp } from '@/server/wallet/service';
import { settleCardBookingFromWebhook } from '@/server/bookings/card-payment';
import { settleConsultationFromWebhook } from '@/server/consultations/direct-payment';
import { settlePaymentLinkFromWebhook } from '@/server/payments/payment-links';
import type { WebhookEvent } from './provider';

export type SettleDispatchResult =
  | { matched: true; kind: string; payload: Record<string, unknown> }
  | { matched: false };

/**
 * Route a verified webhook event to whichever flow owns its id.
 * `matched: false` means no flow recognised the id — the caller should 404 so
 * the mismatch is visible rather than silently acknowledged.
 */
export async function dispatchWebhookSettlement(
  event: WebhookEvent,
): Promise<SettleDispatchResult> {
  // 1. Wallet top-up intent (id = TopUpIntent id). Covers direct top-ups and
  //    the member instant-book shortfall top-up.
  const settle = await confirmTopUp({
    topUpId: event.topUpId,
    providerRef: event.providerRef,
    status: event.status,
  });
  if (settle.ok) {
    return {
      matched: true,
      kind: 'topup',
      payload: {
        topUpId: event.topUpId,
        status: settle.finalStatus,
        replayed: settle.replayed,
      },
    };
  }

  // 2. Not a top-up intent — the external_id may be a card booking or a
  //    consultation (both pass booking.id as the provider id). The webhook is
  //    signature-verified, so settle directly (idempotent). This is the only
  //    path that recovers a payer who never returns to the pay page.
  const card = await settleCardBookingFromWebhook(event.topUpId, event.providerRef, event.status);
  // VOIDED = paid online but the slot was taken at settlement; the booking was
  // cancelled and the operator alerted to refund. Acknowledged like a settle so
  // the provider stops retrying.
  if (card === 'SETTLED' || card === 'ALREADY' || card === 'VOIDED') {
    return { matched: true, kind: 'card_booking', payload: { id: event.topUpId, result: card } };
  }

  const consultation = await settleConsultationFromWebhook(
    event.topUpId,
    event.providerRef,
    event.status,
  );
  if (consultation === 'SETTLED' || consultation === 'ALREADY') {
    return {
      matched: true,
      kind: 'consultation',
      payload: { id: event.topUpId, result: consultation },
    };
  }

  // 3. Direct payment link (id = PaymentLinkRecord.id).
  const payLink = await settlePaymentLinkFromWebhook(event.topUpId, event.providerRef, event.status);
  if (payLink === 'SETTLED' || payLink === 'ALREADY') {
    return { matched: true, kind: 'payment_link', payload: { id: event.topUpId, result: payLink } };
  }

  // A FAILED event for a booking (status IGNORED) is acknowledged so the
  // provider stops retrying; only a genuinely unknown id is unmatched.
  if (card === 'IGNORED' || consultation === 'IGNORED' || payLink === 'IGNORED') {
    return { matched: true, kind: 'ignored', payload: { id: event.topUpId } };
  }

  return { matched: false };
}
