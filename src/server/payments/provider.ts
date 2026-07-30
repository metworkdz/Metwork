/**
 * Payment-provider abstraction.
 *
 * Anything money-moving goes through this interface so providers
 * (mock, SlickPay, CIB, Edahabia…) can be swapped without touching
 * the wallet service.
 *
 * Add a new provider in three steps:
 *   1. Implement this interface in `src/server/payments/<name>-provider.ts`
 *   2. Register it in `src/server/payments/registry.ts`
 *   3. Add its code to `PAYMENT_PROVIDER` enum in `src/lib/env.ts`
 */

export type PaymentProviderCode = 'mock' | 'slickpay' | 'stripe' | 'cib' | 'edahabia';

export interface InitTopUpInput {
  /** Our internal top-up id (acts as idempotency key with the provider). */
  topUpId: string;
  userId: string;
  /** Integer DZD. */
  amount: number;
  /** URL the user is redirected to after paying (success or failure). */
  returnUrl: string;
  /** URL the provider posts the async confirmation to. */
  webhookUrl: string;
  /** Free-form display fields. */
  customer: {
    fullName: string;
    email: string;
    phone: string;
  };
  /**
   * Optional line-item label shown on the hosted checkout. Providers that only
   * render an amount ignore it.
   */
  description?: string;
  /** Optional UI locale hint for the hosted checkout ('en' | 'fr' | 'ar'). */
  locale?: string;
  /**
   * FOREIGN-CURRENCY providers only (Stripe). `amount` above stays the
   * canonical integer DZD; this carries the admin-configured EUR/DZD rate to
   * freeze for this one transaction. Providers that bill in DZD ignore it.
   * Absent for a foreign-currency provider is a hard error, never a guess.
   */
  fx?: { rate: number };
}

export interface InitTopUpResult {
  /** Provider's reference (their invoice / transaction id). */
  providerRef: string;
  /**
   * Where the top-up stands immediately after init.
   * - COMPLETED → provider settled synchronously (mock, sandbox).
   * - PENDING   → caller should redirect the user to `redirectUrl`,
   *               final settlement comes via webhook.
   * - FAILED    → provider rejected the request outright.
   */
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  redirectUrl: string | null;
  /** Provider raw payload for audit / debugging. */
  raw?: unknown;
  /**
   * Set by foreign-currency providers: what the payer's card is actually
   * billed, and the rate frozen to get there. Persisted for audit only —
   * downstream money code keeps using the DZD `amount`.
   */
  foreign?: {
    currency: 'EUR';
    amount: number;
    rate: number;
  };
}

export interface WebhookEvent {
  /** Our internal top-up id, extracted from the payload. */
  topUpId: string;
  providerRef: string;
  status: 'COMPLETED' | 'FAILED';
  raw?: unknown;
}

export interface VerifyWebhookArgs {
  rawBody: string;
  headers: Headers;
  /** Path-derived provider code (e.g. from /api/webhooks/payments/[provider]). */
  provider: string;
}

export interface PaymentProvider {
  code: PaymentProviderCode;
  initTopUp(input: InitTopUpInput): Promise<InitTopUpResult>;
  /**
   * Verify signature, parse the payload, return canonical event.
   * Returns null when the request is not authentic — the route handler
   * will respond 401 in that case.
   */
  verifyWebhook(args: VerifyWebhookArgs): Promise<WebhookEvent | null>;
}
