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

// Real SlickPay v2 hosts: sandbox = devapi.slick-pay.com, production =
// prodapi.slick-pay.com. (The old `prod.slick-pay.com` host does not resolve.)
// IMPORTANT: the public key and the host must match — a prod key against
// devapi (or vice-versa) returns `401 Unauthenticated` and the top-up never
// produces a checkout URL. Override per-environment via SLICKPAY_BASE_URL.
const DEFAULT_API_BASE = 'https://prodapi.slick-pay.com/api/v2';

/**
 * Dev-only request/response tracing. Guarded so it never logs in production.
 * The Authorization header is never passed in, so the public key can't leak.
 */
const SLICKPAY_DEBUG = process.env.NODE_ENV !== 'production';
function devLog(...args: unknown[]): void {
  if (SLICKPAY_DEBUG) console.info('[slickpay]', ...args);
}

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

/** Supported UI locales — used to keep the cancel page in the payer's language. */
const LOCALES = new Set(['en', 'fr', 'ar']);

/** Extract the locale segment from the return URL so the cancel page matches it. */
function localeFromReturnUrl(returnUrl: string): string {
  try {
    const seg = new URL(returnUrl).pathname.split('/').filter(Boolean)[0];
    return seg && LOCALES.has(seg) ? seg : 'fr';
  } catch {
    return 'fr';
  }
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
    const locale = localeFromReturnUrl(input.returnUrl);

    const endpoint = `${cfg.apiBase}/users/transfers`;
    const requestBody = {
      amount: input.amount,
      url: input.returnUrl,
      cancel_url: `${base}/${locale}/payment/cancel`,
      // Echo our internal id back on the webhook so settlement can map the
      // callback to the originating top-up intent / booking. Without this the
      // signed webhook has no `external_id` and can never settle (the return-
      // page poll was the only working path). Sent under several key names
      // for resilience across SlickPay payload variants.
      external_id: input.topUpId,
      metadata: { external_id: input.topUpId },
    };
    devLog(`POST ${endpoint}`, requestBody);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(cfg),
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      throw new ProviderRequestError(
        `SlickPay network error: ${err instanceof Error ? err.message : String(err)}`,
        null,
      );
    }

    // Read the raw text first so we can log the exact response even when it's
    // not valid JSON (e.g. an HTML error page or a bare `401 Unauthenticated`).
    const rawText = await res.text();
    devLog(`POST ${endpoint} -> HTTP ${res.status}`, rawText);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawText) as Record<string, unknown>;
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
      externalId?: string;
      metadata?: { external_id?: string } | null;
      id?: string | number;
      completed?: number;
      status?: string;
    };

    // Our internal id (top-up intent id or booking id), echoed back from init.
    const topUpId = body.external_id ?? body.externalId ?? body.metadata?.external_id;
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

  const endpoint = `${cfg.apiBase}/users/transfers/${encodeURIComponent(transferId)}`;
  devLog(`GET ${endpoint}`);

  let res: Response;
  try {
    res = await fetch(endpoint, { headers: authHeaders(cfg) });
  } catch (err) {
    throw new ProviderRequestError(
      `SlickPay network error: ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }

  const rawText = await res.text();
  devLog(`GET ${endpoint} -> HTTP ${res.status}`, rawText);

  if (!res.ok) {
    throw new ProviderRequestError(`SlickPay status check failed (${res.status})`, res.status);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new ProviderRequestError(`SlickPay returned non-JSON (${res.status})`, res.status);
  }
  // `completed` (0|1) sits at the top level of the status response.
  const completed = Number(body.completed ?? 0) === 1 ? 1 : 0;
  return { completed: completed as 0 | 1 };
}

