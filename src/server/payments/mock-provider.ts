/**
 * Mock payment provider — no external calls, useful for local dev and
 * exercising the wallet flow end-to-end before a real processor is wired.
 *
 * Two modes, controlled by `MOCK_PAYMENT_MODE`:
 *  - `sync`  (default) — initTopUp returns COMPLETED immediately. The
 *    wallet service settles the top-up in the same request.
 *  - `async` — initTopUp returns PENDING with a `redirectUrl` that loops
 *    back through our own webhook endpoint, simulating a real hosted-
 *    checkout round trip without leaving localhost.
 *
 * Webhook auth: any well-formed JSON body of shape
 *   { topUpId: string, status: 'COMPLETED' | 'FAILED', providerRef?: string }
 * is accepted. Real providers MUST sign their webhooks (see slickpay-provider).
 */
import { randomBytes } from 'node:crypto';
import { clientEnvVars } from '@/lib/env';
import type {
  InitTopUpInput,
  InitTopUpResult,
  PaymentProvider,
  VerifyWebhookArgs,
  WebhookEvent,
} from './provider';

function mode(): 'sync' | 'async' {
  return process.env.MOCK_PAYMENT_MODE === 'async' ? 'async' : 'sync';
}

function buildLoopbackRedirect(input: InitTopUpInput, providerRef: string): string {
  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const params = new URLSearchParams({
    topUpId: input.topUpId,
    providerRef,
    status: 'COMPLETED',
    next: input.returnUrl,
  });
  return `${base}/api/webhooks/payments/mock/loopback?${params.toString()}`;
}

export const mockProvider: PaymentProvider = {
  code: 'mock',

  async initTopUp(input: InitTopUpInput): Promise<InitTopUpResult> {
    const providerRef = `mock_${randomBytes(8).toString('hex')}`;
    if (mode() === 'sync') {
      return { providerRef, status: 'COMPLETED', redirectUrl: null };
    }
    return {
      providerRef,
      status: 'PENDING',
      redirectUrl: buildLoopbackRedirect(input, providerRef),
    };
  },

  async verifyWebhook({ rawBody }: VerifyWebhookArgs): Promise<WebhookEvent | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { topUpId?: unknown }).topUpId !== 'string'
    ) {
      return null;
    }
    const body = parsed as {
      topUpId: string;
      status?: string;
      providerRef?: string;
    };
    const status = body.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
    return {
      topUpId: body.topUpId,
      providerRef: body.providerRef ?? `mock_${body.topUpId}`,
      status,
      raw: body,
    };
  },
};
