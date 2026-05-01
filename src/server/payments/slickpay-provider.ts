/**
 * SlickPay v2 provider — hosted-checkout + poll-to-verify flow.
 *
 * Quick integration path:
 *   1. POST /users/transfers  → get transferId + paymentUrl
 *   2. Redirect user to paymentUrl
 *   3. On return, GET /users/transfers/:id to verify completed=1
 *   4. confirmTopUp() settles the wallet (idempotent — safe to call twice)
 *
 * Webhook path (future): verifyWebhook() is already stubbed below and
 * shares the same confirmTopUp call, so both paths can coexist.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderNotConfiguredError, ProviderRequestError } from './errors';
import type {
  InitTopUpInput,
  InitTopUpResult,
  PaymentProvider,
  VerifyWebhookArgs,
  WebhookEvent,
} from './provider';

const DEFAULT_API_BASE = 'https://prod.slick-pay.com/api/v2';

interface SlickPayConfig {
  publicKey: string;
  webhookSecret: string;
  apiBase: string;
}

function readConfig(): SlickPayConfig | null {
  const publicKey = process.env.SLICKPAY_PUBLIC_KEY;
  if (!publicKey) return null;
  return {
    publicKey,
    webhookSecret: process.env.SLICKPAY_WEBHOOK_SECRET ?? '',
    // SLICKPAY_BASE_URL takes precedence over the legacy SLICKPAY_API_BASE.
    apiBase:
      process.env.SLICKPAY_BASE_URL ??
      process.env.SLICKPAY_API_BASE ??
      DEFAULT_API_BASE,
  };
}

function authHeaders(cfg: SlickPayConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.publicKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/* ─────────────────────────── Provider implementation ─────────────────────────── */

export const slickpayProvider: PaymentProvider = {
  code: 'slickpay',

  async initTopUp(input: InitTopUpInput): Promise<InitTopUpResult> {
    const cfg = readConfig();
    if (!cfg) throw new ProviderNotConfiguredError('slickpay');

    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}/users/transfers`, {
        method: 'POST',
        headers: authHeaders(cfg),
        body: JSON.stringify({
          amount: input.amount,
          url: input.returnUrl,
          cancel_url: `${base}/en/payment/cancel`,
        }),
      });
    } catch (err) {
      throw new ProviderRequestError(
        `SlickPay network error: ${err instanceof Error ? err.message : String(err)}`,
        null,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new ProviderRequestError(`SlickPay returned non-JSON (${res.status})`, res.status);
    }

    if (!res.ok) {
      const msg =
        (body.message as string | undefined) ??
        (body.error as string | undefined) ??
        `HTTP ${res.status}`;
      throw new ProviderRequestError(`SlickPay transfer failed: ${msg}`, res.status);
    }

    // SlickPay may return the checkout URL under different field names.
    const providerRef = String(
      body.id ?? body.transfer_id ?? body.transferId ?? '',
    );
    const redirectUrl = String(
      body.url ?? body.payment_url ?? body.paymentUrl ?? body.checkout_url ?? '',
    );

    if (!providerRef || !redirectUrl) {
      throw new ProviderRequestError(
        'SlickPay response is missing required id / url fields',
        null,
      );
    }

    return {
      providerRef,
      status: 'PENDING',
      redirectUrl,
      raw: body,
    };
  },

  async verifyWebhook({ rawBody, headers }: VerifyWebhookArgs): Promise<WebhookEvent | null> {
    const cfg = readConfig();
    if (!cfg) throw new ProviderNotConfiguredError('slickpay');
    if (!cfg.webhookSecret) return null;

    const signature = headers.get('x-slickpay-signature') ?? '';
    if (!signature) return null;

    const expected = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
    if (!constantTimeEqualHex(signature, expected)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const body = parsed as {
      external_id?: string;
      id?: string | number;
      completed?: number;
      status?: string;
    };

    const topUpId = body.external_id;
    if (!topUpId) return null;

    const isCompleted =
      body.completed === 1 || body.status === 'paid' || body.status === 'completed';

    return {
      topUpId,
      providerRef: body.id != null ? String(body.id) : topUpId,
      status: isCompleted ? 'COMPLETED' : 'FAILED',
      raw: body,
    };
  },
};

/* ─────────────────────────── Poll-based status check ─────────────────────────── */

/**
 * Verify a single transfer directly via the SlickPay API.
 * Used by the /payment/success page instead of relying on webhooks.
 * Returns `completed: 1` when paid, `completed: 0` otherwise.
 */
export async function getSlickPayTransferStatus(
  transferId: string,
): Promise<{ completed: 0 | 1 }> {
  const cfg = readConfig();
  if (!cfg) throw new ProviderNotConfiguredError('slickpay');

  let res: Response;
  try {
    res = await fetch(
      `${cfg.apiBase}/users/transfers/${encodeURIComponent(transferId)}`,
      { headers: authHeaders(cfg) },
    );
  } catch (err) {
    throw new ProviderRequestError(
      `SlickPay network error: ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }

  if (!res.ok) {
    throw new ProviderRequestError(`SlickPay status check failed (${res.status})`, res.status);
  }

  const body = (await res.json()) as Record<string, unknown>;
  const completed = Number(body.completed ?? 0) === 1 ? 1 : 0;
  return { completed: completed as 0 | 1 };
}
