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

export type PaymentProviderCode = 'mock' | 'slickpay' | 'cib' | 'edahabia';

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
