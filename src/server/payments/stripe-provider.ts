/**
 * Stripe provider — hosted Checkout redirect, billed in EUR.
 *
 * Deliberately implements the SAME `PaymentProvider` interface as SlickPay so
 * every downstream settler (confirmTopUp, the consultation direct-payment
 * settler, the webhook dispatcher) treats a Stripe payment identically to a
 * CIB/Edahabia one. There is no Stripe branch anywhere in pricing, commission,
 * the consultant ledger, receipts or notifications.
 *
 * Currency boundary: `input.amount` is always the canonical integer DZD. This
 * module is the ONLY place it becomes EUR, at the rate frozen in `input.fx`
 * (see `./fx`). The EUR figure is returned for audit and never flows onward.
 *
 * Flow:
 *   1. createCheckoutSession → { providerRef: session.id, redirectUrl: session.url }
 *   2. Redirect the payer to Stripe
 *   3. checkout.session.completed webhook (authoritative) settles
 *   4. getStripeSessionStatus() is the return-page poll fallback, mirroring
 *      getSlickPayTransferStatus
 */
import Stripe from 'stripe';
import { ProviderNotConfiguredError, ProviderRequestError } from './errors';
import { convertDzdToEur, FxError } from './fx';
import type {
  InitTopUpInput,
  InitTopUpResult,
  PaymentProvider,
  VerifyWebhookArgs,
  WebhookEvent,
} from './provider';

/** Supported checkout UI locales, mapped to Stripe's locale codes. */
const CHECKOUT_LOCALES: Record<string, Stripe.Checkout.SessionCreateParams.Locale> = {
  en: 'en',
  fr: 'fr',
  // Stripe Checkout has no Arabic locale — French is the closest fit for our
  // Algerian audience and keeps the page from defaulting to English.
  ar: 'fr',
};

let cached: Stripe | null = null;

/**
 * Lazily construct the SDK client. Returns null when the key is absent so the
 * app boots (and every other payment path keeps working) without Stripe
 * configured — callers turn that into ProviderNotConfiguredError.
 */
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, {
      // Pin behaviour to the SDK's bundled version rather than the account
      // default, so a dashboard-side API upgrade can't change our semantics.
      typescript: true,
      appInfo: { name: 'Metwork', url: 'https://metwork.dz' },
    });
  }
  return cached;
}

/** True when Stripe is configured well enough to accept a payment. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new ProviderNotConfiguredError('stripe');
  return stripe;
}

/* ─────────────────────────── Provider implementation ─────────────────────────── */

export const stripeProvider: PaymentProvider = {
  code: 'stripe',

  async initTopUp(input: InitTopUpInput): Promise<InitTopUpResult> {
    const stripe = requireStripe();

    // The rate MUST be supplied by the caller (snapshotted from platform
    // settings). Never read it here — that would let a rate change mid-flight
    // reprice an already-quoted checkout.
    let conversion;
    try {
      conversion = convertDzdToEur(input.amount, input.fx?.rate);
    } catch (err) {
      if (err instanceof FxError) throw new ProviderRequestError(err.message, null);
      throw err;
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          success_url: input.returnUrl,
          cancel_url: input.returnUrl,
          customer_email: input.customer.email || undefined,
          locale: CHECKOUT_LOCALES[input.locale ?? 'fr'] ?? 'fr',
          // Adaptive Pricing is on by default per the Stripe dashboard setting
          // and detects the buyer's card/IP country to offer a "Choose
          // currency" picker (e.g. SGD) alongside EUR. That contradicts the
          // frozen-rate DZD→EUR conversion above — the payer must be charged
          // exactly `conversion.amountEurCents` in EUR, not a second
          // Stripe-computed conversion in a different currency.
          adaptive_pricing: { enabled: false },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'eur',
                unit_amount: conversion.amountEurCents,
                product_data: {
                  name: input.description ?? 'Metwork consultation',
                },
              },
            },
          ],
          // `external_id` mirrors the SlickPay payload key so the shared webhook
          // settle-dispatch can read one field regardless of provider.
          client_reference_id: input.topUpId,
          metadata: {
            external_id: input.topUpId,
            userId: input.userId,
            amount_dzd: String(input.amount),
            eur_dzd_rate: String(conversion.rate),
          },
          payment_intent_data: {
            metadata: {
              external_id: input.topUpId,
              amount_dzd: String(input.amount),
            },
          },
        },
        // Idempotent on our internal id: a retried create returns the SAME
        // session instead of opening a second chargeable checkout.
        { idempotencyKey: `metwork-checkout-${input.topUpId}` },
      );
    } catch (err) {
      const status = err instanceof Stripe.errors.StripeError ? (err.statusCode ?? null) : null;
      throw new ProviderRequestError(
        `Stripe checkout session failed: ${err instanceof Error ? err.message : String(err)}`,
        status,
      );
    }

    if (!session.url) {
      throw new ProviderRequestError('Stripe returned a session with no checkout URL', null);
    }

    return {
      providerRef: session.id,
      status: 'PENDING',
      redirectUrl: session.url,
      foreign: { currency: 'EUR', amount: conversion.amountEur, rate: conversion.rate },
      raw: { id: session.id, amount_total: session.amount_total, currency: session.currency },
    };
  },

  /**
   * PaymentProvider conformance. Collapses to the interface's contract (null ⇒
   * reject), losing the reason. The Stripe route uses `verifyStripeWebhook`
   * below instead, so it can answer 401 to a forgery but 200 to an authentic
   * event we simply don't act on.
   */
  async verifyWebhook(args: VerifyWebhookArgs): Promise<WebhookEvent | null> {
    const outcome = await verifyStripeWebhook(args);
    return outcome.authentic ? outcome.event : null;
  },
};

export type StripeVerifyOutcome =
  /** Signature missing or forged — nothing may be trusted. */
  | { authentic: false }
  /** Signature valid. `event` is null when it isn't an event we settle on. */
  | { authentic: true; event: WebhookEvent | null };

/**
 * Verify the `stripe-signature` header and map the payload to our canonical
 * event shape.
 *
 * Separates "not authentic" from "authentic but irrelevant" because the two
 * need different answers: a forgery is a 401, while an event type we ignore
 * (checkout.session.expired, and the ~100 others Stripe may send) must be
 * acknowledged with a 200 or Stripe retries it forever.
 *
 * There is NO development bypass — an unverified webhook can move money.
 */
export async function verifyStripeWebhook({
  rawBody,
  headers,
}: VerifyWebhookArgs): Promise<StripeVerifyOutcome> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) throw new ProviderNotConfiguredError('stripe');

  const signature = headers.get('stripe-signature');
  if (!signature) return { authentic: false };

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return { authentic: false };
  }

  // Only terminal checkout outcomes move money.
  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded' &&
    event.type !== 'checkout.session.async_payment_failed'
  ) {
    return { authentic: true, event: null };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const externalId =
    (session.metadata?.external_id as string | undefined) ??
    session.client_reference_id ??
    undefined;
  if (!externalId) return { authentic: true, event: null };

  const paid =
    event.type === 'checkout.session.completed'
      ? session.payment_status === 'paid'
      : event.type === 'checkout.session.async_payment_succeeded';

  return {
    authentic: true,
    event: {
      topUpId: externalId,
      providerRef: session.id,
      status: paid ? 'COMPLETED' : 'FAILED',
      raw: { type: event.type, id: session.id, payment_status: session.payment_status },
    },
  };
}

/* ─────────────────────────── Poll-based status check ─────────────────────────── */

/**
 * Ask Stripe directly whether a checkout session has been paid. UX fallback for
 * the return page while the webhook remains the source of truth — the exact
 * role `getSlickPayTransferStatus` plays for CIB/Edahabia.
 */
export async function getStripeSessionStatus(sessionId: string): Promise<{ completed: 0 | 1 }> {
  const stripe = requireStripe();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    const status = err instanceof Stripe.errors.StripeError ? (err.statusCode ?? null) : null;
    throw new ProviderRequestError(
      `Stripe session lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      status,
    );
  }

  return { completed: session.payment_status === 'paid' ? 1 : 0 };
}
