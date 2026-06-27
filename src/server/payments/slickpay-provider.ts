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

/* ─────────────────────────── Disbursement (payout to RIB) ───────────────────────────
 * Sending money OUT to a beneficiary RIB. Same `users/transfers` family + same
 * Bearer public key as the collection/top-up path above (single canonical
 * client) — outbound mode is distinguished by posting `account` (a beneficiary
 * uuid) instead of the collection's `url`-only body. Contract confirmed from the
 * official SlickPay SDKs (slickpay-laravel `src/User/{Transfer,Account}.php`,
 * SlickPAY-API-Flutter `lib/src/repositories/transfer_repository.dart`):
 *   1. POST users/accounts   {rib, firstname, lastname, address}  → {uuid}
 *   2. POST users/transfers  {amount, account: <uuid>, url}        → {id}
 *   3. GET  users/transfers/:id                                    → {completed}
 *   4. POST users/transfers/commission {amount}                    → {commission}
 */

// SLICKPAY-CONFIRM: which endpoint registers a payout beneficiary RIB. Concrete
// SDK evidence (Flutter transfer_repository) shows the transfer body field is
// `account`, whose uuid comes from `users/accounts`. The official v2 docs also
// expose `users/contacts`; if a live test shows the transfer consumes a CONTACT
// uuid instead, flip this one constant (and `TRANSFER_TARGET_FIELD` below).
const BENEFICIARY_ENDPOINT = 'users/accounts';
// SLICKPAY-CONFIRM: the transfer body field that references the beneficiary uuid.
const TRANSFER_TARGET_FIELD = 'account';

/** Shared authenticated JSON POST for the disbursement endpoints. */
async function slickpayPost(
  cfg: SlickPayConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = `${cfg.apiBase}/${path}`;
  devLog(`POST ${endpoint}`, body);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderRequestError(
      `SlickPay network error: ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }

  const rawText = await res.text();
  devLog(`POST ${endpoint} -> HTTP ${res.status}`, rawText);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new ProviderRequestError(`SlickPay returned non-JSON (${res.status})`, res.status);
  }

  if (!res.ok) {
    const msg =
      (parsed.message as string | undefined) ??
      (parsed.error as string | undefined) ??
      // SlickPay validation errors (422) arrive under `errors`.
      (parsed.errors ? JSON.stringify(parsed.errors) : undefined) ??
      `HTTP ${res.status}`;
    throw new ProviderRequestError(`SlickPay request failed: ${msg}`, res.status);
  }
  return parsed;
}

/**
 * Register a beneficiary bank account (RIB) for disbursement.
 * `POST users/accounts` → returns the account uuid used as the transfer target.
 */
export async function createSlickpayBeneficiary(input: {
  rib: string;
  firstname: string;
  lastname: string;
  address: string;
  title?: string;
  email?: string;
}): Promise<{ uuid: string }> {
  const cfg = readConfig();
  if (!cfg) throw new ProviderNotConfiguredError('slickpay');

  const body = await slickpayPost(cfg, BENEFICIARY_ENDPOINT, {
    title: input.title ?? `${input.firstname} ${input.lastname}`.trim(),
    rib: input.rib,
    firstname: input.firstname,
    lastname: input.lastname,
    address: input.address,
    // SLICKPAY-CONFIRM: the contacts endpoint additionally expects `email`.
    ...(input.email ? { email: input.email } : {}),
  });

  const uuid = String(body.uuid ?? body.id ?? '');
  if (!uuid) {
    throw new ProviderRequestError('SlickPay account response missing uuid', null);
  }
  return { uuid };
}

/**
 * Create a disbursement to a previously-registered beneficiary account.
 * `POST users/transfers` with `account` (uuid) → returns the transfer id, which
 * is later polled via {@link getSlickPayTransferStatus} for `completed=1`.
 */
export async function createSlickpayDisbursement(input: {
  /** Integer DZD — the amount the beneficiary receives. */
  amount: number;
  /** Beneficiary account uuid from {@link createSlickpayBeneficiary}. */
  accountUuid: string;
  /** Return URL (carries the locale; SlickPay echoes it on its flow). */
  returnUrl: string;
}): Promise<{ transferId: string; redirectUrl: string | null; raw: unknown }> {
  const cfg = readConfig();
  if (!cfg) throw new ProviderNotConfiguredError('slickpay');

  const body = await slickpayPost(cfg, 'users/transfers', {
    amount: input.amount,
    [TRANSFER_TARGET_FIELD]: input.accountUuid,
    url: input.returnUrl,
  });

  const transferId = String(body.id ?? body.transfer_id ?? body.transferId ?? '');
  if (!transferId) {
    throw new ProviderRequestError('SlickPay transfer response missing id', null);
  }
  // SLICKPAY-CONFIRM: a disbursement MAY complete silently (no URL) or return a
  // confirmation/redirect URL needing interactive validation. Surface it when
  // present; the caller keeps the payout PROCESSING until it confirms "sent".
  const redirectUrl =
    String(body.url ?? body.redirect_url ?? body.payment_url ?? body.checkout_url ?? '') || null;
  return { transferId, redirectUrl, raw: body };
}

/**
 * Compute the SlickPay fee for a transfer of `amount` DZD.
 * `POST users/transfers/commission`. Best-effort accounting helper — the caller
 * treats a thrown/zero result as "fee unknown" and never blocks the payout on it.
 */
export async function getSlickpayTransferCommission(
  amount: number,
): Promise<{ commission: number }> {
  const cfg = readConfig();
  if (!cfg) throw new ProviderNotConfiguredError('slickpay');

  const body = await slickpayPost(cfg, 'users/transfers/commission', { amount });
  const commission = Number(body.commission ?? body.fee ?? body.amount ?? 0);
  return { commission: Number.isFinite(commission) ? commission : 0 };
}
