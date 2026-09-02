/**
 * Direct payment links — an incubator invoices a client who does NOT need a
 * Metwork account. The incubator shares a public `/pay/<slug>` URL; the payer
 * enters their name + email and pays by card via the hosted SlickPay checkout.
 *
 * This is the money-critical sibling of the card-booking flow in
 * `bookings/card-payment.ts` and reuses the same guarantees:
 *
 *   - The amount is the incubator-set base, frozen on the record at creation;
 *     the client never supplies a price. The payer-side fee is frozen at payment
 *     init (when the payer commits), so the hosted-checkout amount honours the
 *     quote shown.
 *   - Single-use: once a link is PAID it can never be paid again. Cancelled /
 *     expired links refuse payment.
 *   - Settlement is idempotent: the PAID transition is claimed via the link's
 *     `status` inside ONE store mutation, so replays (refresh, double return,
 *     webhook + return + cron) move money exactly once.
 *   - Payment is only ever confirmed by asking the provider directly
 *     (`getSlickPayTransferStatus`) or by a synchronous provider result — never
 *     by trusting the browser redirect.
 *
 * Money model — central commission engine (src/server/payments/commission.ts):
 *   The payer is charged `amount + payerFee` (default 2 % on top). At settlement
 *   the incubator wallet moves:
 *     +amount             (PAYOUT — the base money received)
 *     −receiverCommission (COMMISSION — receiver cut on the base, default 5 %)
 *   Incubators on an ACTIVE subscription resolve to the effective FLAT plan, so
 *   their receiver commission is 0 — but their payers still pay the payer fee.
 *   Net credited = amount − receiverCommission, always ≥ 0 (commission ≤ base).
 *   The payer fee is platform revenue and is never credited to the incubator.
 */
import { randomBytes } from 'node:crypto';
import {
  db,
  type IncubatorRecord,
  type PaymentLinkRecord,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import {
  computeCommission as quoteCommission,
  type ProviderPlan,
} from '@/server/payments/commission';
import { getEffectiveSubscriptionCode } from '@/server/incubator/service';
import { getActiveProvider } from '@/server/payments/registry';
import { getSlickPayTransferStatus } from '@/server/payments/slickpay-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import {
  sendPaymentLinkReceiptEmail,
  sendPaymentLinkPaidIncubatorEmail,
} from '@/server/notifications/mock';

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

/* ──────────────────────────── Internal helpers ──────────────────────────── */

/** Mint an unguessable, url-safe slug. base64url(16 bytes) ⇒ 22 chars. */
function newSlug(): string {
  return randomBytes(16).toString('base64url');
}

function ensureWallet(d: StoreDraft, userId: string): WalletRecord {
  let wallet = d.wallets.find((w) => w.userId === userId);
  if (!wallet) {
    const now = new Date().toISOString();
    wallet = {
      id: newSlug(),
      userId,
      balance: 0,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    d.wallets.push(wallet);
  }
  return wallet;
}

function findBySlug(
  links: PaymentLinkRecord[] | undefined,
  slug: string,
): PaymentLinkRecord | undefined {
  return (links ?? []).find((l) => l.slug === slug);
}

/** Expiry only matters for an ACTIVE link that has never been paid. */
function isExpired(link: PaymentLinkRecord): boolean {
  return (
    link.hasExpiry === true &&
    typeof link.expiresAt === 'string' &&
    new Date(link.expiresAt).getTime() < Date.now()
  );
}

/** Resolve the incubator's effective billing plan for the commission engine. */
function planFor(inc: IncubatorRecord | null | undefined): ProviderPlan {
  return inc ? getEffectiveSubscriptionCode(inc) : 'COMMISSION';
}

/* ──────────────────────────── Incubator-facing CRUD ──────────────────────────── */

export interface CreatePaymentLinkInput {
  incubatorId: string;
  serviceName: string;
  amount: number;
  description?: string | null;
  hasExpiry: boolean;
  /** Required when hasExpiry — ISO date string. */
  expiresAt?: string | null;
}

/** Create an ACTIVE payment link with a freshly-minted unique slug. */
export async function createPaymentLink(
  input: CreatePaymentLinkInput,
): Promise<PaymentLinkRecord> {
  return db.update<PaymentLinkRecord>((d) => {
    if (!Array.isArray(d.paymentLinks)) d.paymentLinks = [];
    // Mint a slug that doesn't collide with an existing one.
    let slug = newSlug();
    while (d.paymentLinks.some((l) => l.slug === slug)) slug = newSlug();

    const now = new Date().toISOString();
    const link: PaymentLinkRecord = {
      id: newSlug(),
      incubatorId: input.incubatorId,
      serviceName: input.serviceName,
      amount: input.amount,
      description: input.description ?? null,
      slug,
      status: 'ACTIVE',
      hasExpiry: input.hasExpiry,
      expiresAt: input.hasExpiry ? input.expiresAt ?? null : null,
      payerName: null,
      payerEmail: null,
      providerRef: null,
      payerFeeAmount: null,
      payerFeeRate: null,
      grossChargedToPayer: null,
      commissionAmount: null,
      commissionRate: null,
      locale: null,
      paidReceiptSentAt: null,
      incubatorNotifiedAt: null,
      createdAt: now,
      paidAt: null,
      updatedAt: now,
    };
    d.paymentLinks.push(link);
    return link;
  });
}

/** All of an incubator's links, newest first. */
export async function listPaymentLinks(incubatorId: string): Promise<PaymentLinkRecord[]> {
  const data = await db.read();
  return (data.paymentLinks ?? [])
    .filter((l) => l.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type CancelPaymentLinkResult =
  | { ok: true; link: PaymentLinkRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_PAID' };

/**
 * Cancel a link — only while it has not been PAID. Idempotent: cancelling an
 * already-CANCELLED (or EXPIRED) link is a no-op success. Ownership is enforced
 * by requiring the caller's incubatorId to match.
 */
export async function cancelPaymentLink(
  id: string,
  incubatorId: string,
): Promise<CancelPaymentLinkResult> {
  return db.update<CancelPaymentLinkResult>((d) => {
    const link = (d.paymentLinks ?? []).find(
      (l) => l.id === id && l.incubatorId === incubatorId,
    );
    if (!link) return { ok: false, reason: 'NOT_FOUND' };
    if (link.status === 'PAID') return { ok: false, reason: 'ALREADY_PAID' };
    if (link.status === 'CANCELLED') return { ok: true, link };
    link.status = 'CANCELLED';
    link.updatedAt = new Date().toISOString();
    return { ok: true, link };
  });
}

/* ──────────────────────────── Public pay-page view ──────────────────────────── */

export type PaymentLinkPayState =
  | 'INVALID'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED';

export interface PaymentLinkIncubatorView {
  name: string;
  logoUrl: string | null;
  city: string | null;
}

export interface PaymentLinkPayView {
  state: PaymentLinkPayState;
  link?: PaymentLinkRecord;
  incubator?: PaymentLinkIncubatorView;
  /** Base amount invoiced. */
  amount?: number;
  /** Payer-side fee added on top (preview before init, frozen value after). */
  payerFee?: number;
  /** Gross the payer is charged = amount + payerFee. */
  grossCharge?: number;
}

function resolveStatePure(link: PaymentLinkRecord): PaymentLinkPayState {
  if (link.status === 'PAID') return 'PAID';
  if (link.status === 'CANCELLED') return 'CANCELLED';
  if (link.status === 'EXPIRED' || isExpired(link)) return 'EXPIRED';
  return 'AWAITING_PAYMENT';
}

function buildView(
  data: Awaited<ReturnType<typeof db.read>>,
  link: PaymentLinkRecord,
  state: PaymentLinkPayState,
): PaymentLinkPayView {
  const inc = (data.incubators ?? []).find((i) => i.id === link.incubatorId) ?? null;
  // Fee preview/frozen. Once frozen at init we show the locked values; before
  // that we preview against the incubator's current effective plan + config.
  let payerFee = link.payerFeeAmount ?? 0;
  let grossCharge = link.grossChargedToPayer ?? 0;
  if (link.grossChargedToPayer == null) {
    const quote = quoteCommission({
      transactionType: 'PAYMENT',
      providerPlan: planFor(inc),
      baseAmount: link.amount,
      config: data.meta?.platformConfig,
    });
    payerFee = quote.payerFee;
    grossCharge = quote.grossChargedToPayer;
  }
  return {
    state,
    link,
    incubator: inc
      ? { name: inc.name, logoUrl: inc.logoUrl ?? null, city: inc.city ?? null }
      : undefined,
    amount: link.amount,
    payerFee,
    grossCharge,
  };
}

/** Read-only view for the public pay page. Never calls the provider or settles. */
export async function getPaymentLinkPayView(slug: string): Promise<PaymentLinkPayView> {
  const data = await db.read();
  const link = findBySlug(data.paymentLinks, slug);
  if (!link) return { state: 'INVALID' };
  return buildView(data, link, resolveStatePure(link));
}

/* ──────────────────────────── Settlement ──────────────────────────── */

type SettleOutcome =
  | { kind: 'SETTLED'; link: PaymentLinkRecord; claimed: boolean }
  | { kind: 'CANCELLED'; link: PaymentLinkRecord }
  | { kind: 'NOT_FOUND' };

/**
 * Atomically claim the PAID transition and move money. Idempotent — only the
 * first caller flips `status` to PAID, credits the incubator (+amount), debits
 * the receiver commission (−C) and stamps `paidAt`. Replays are no-ops. A link
 * that completed at the provider is honoured even if it has since "expired" —
 * expiry only blocks starting a new payment, never a payment already made.
 */
async function applyPaymentLinkSettlement(
  id: string,
  providerRef: string | null,
): Promise<SettleOutcome> {
  return db.update<SettleOutcome>((d) => {
    const link = (d.paymentLinks ?? []).find((l) => l.id === id);
    if (!link) return { kind: 'NOT_FOUND' };

    if (link.status === 'PAID') return { kind: 'SETTLED', link, claimed: false };
    if (link.status === 'CANCELLED') return { kind: 'CANCELLED', link };

    const now = new Date().toISOString();

    // ── Claim the PAID transition ─────────────────────────────────────────
    link.status = 'PAID';
    link.paidAt = now;
    if (providerRef) link.providerRef = providerRef;
    link.updatedAt = now;

    // ── Commission (central engine) on the base amount ────────────────────
    const incubator = (d.incubators ?? []).find((i) => i.id === link.incubatorId) ?? null;
    const base = link.amount;
    const quote = quoteCommission({
      transactionType: 'PAYMENT',
      providerPlan: planFor(incubator),
      baseAmount: base,
      config: d.meta?.platformConfig,
    });
    const commission = quote.receiverCommission;
    link.commissionRate = quote.receiverRate;
    link.commissionAmount = commission;
    // Freeze the payer fee too if init never recorded it (defensive).
    if (link.payerFeeAmount == null) {
      link.payerFeeAmount = quote.payerFee;
      link.payerFeeRate = quote.payerRate;
      link.grossChargedToPayer = quote.grossChargedToPayer;
    }

    // ── Incubator wallet: +base (PAYOUT), −commission (COMMISSION) ─────────
    if (incubator?.managerId) {
      const wallet = ensureWallet(d, incubator.managerId);
      if (base > 0 && wallet.status !== 'FROZEN') {
        wallet.balance += base;
        wallet.updatedAt = now;
        const payoutTx: TransactionRecord = {
          id: newSlug(),
          walletId: wallet.id,
          userId: incubator.managerId,
          type: 'PAYOUT',
          amount: base,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: `Payment link — ${link.serviceName}`,
          reference: `payout-link-${link.id}`,
          provider: 'internal',
          providerTxnId: providerRef,
          metadata: {
            paymentLinkId: link.id,
            payerEmail: link.payerEmail,
            payerName: link.payerName,
          },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(payoutTx);
      }
      // Net stays ≥ 0 (commission ≤ base), so no negative-balance debt.
      if (commission > 0 && wallet.status !== 'FROZEN') {
        wallet.balance -= commission;
        wallet.updatedAt = now;
        const commissionTx: TransactionRecord = {
          id: newSlug(),
          walletId: wallet.id,
          userId: incubator.managerId,
          type: 'COMMISSION',
          amount: -commission,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: `Platform commission — ${link.serviceName}`,
          reference: `commission-link-${link.id}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: {
            paymentLinkId: link.id,
            base,
            rate: quote.receiverRate,
            payerFee: link.payerFeeAmount ?? 0,
            payerRate: link.payerFeeRate ?? 0,
            platformTake: quote.platformTake,
          },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(commissionTx);
      }
    }

    return { kind: 'SETTLED', link, claimed: true };
  });
}

/* ──────────────────────────── Notifications ──────────────────────────── */

interface NotifyClaim {
  link: PaymentLinkRecord;
  incubator: IncubatorRecord;
  sendReceipt: boolean;
  notifyIncubator: boolean;
}

/**
 * Issue the payer receipt + the incubator "new payment received" email, each
 * exactly once. The dedup stamps are claimed inside one mutation; the actual
 * sends are fire-and-forget outside the lock and can never throw into / roll
 * back the money path.
 */
export async function dispatchPaymentLinkNotificationsIfDue(id: string): Promise<void> {
  try {
    let claim: NotifyClaim | null = null;

    await db.update((d) => {
      const link = (d.paymentLinks ?? []).find((l) => l.id === id);
      if (!link || link.status !== 'PAID') return;
      const incubator = (d.incubators ?? []).find((i) => i.id === link.incubatorId);
      if (!incubator) return;

      const now = new Date().toISOString();
      const sendReceipt = !link.paidReceiptSentAt && !!link.payerEmail;
      const notifyIncubator = !link.incubatorNotifiedAt;
      if (sendReceipt) link.paidReceiptSentAt = now;
      if (notifyIncubator) link.incubatorNotifiedAt = now;
      if (sendReceipt || notifyIncubator) {
        claim = { link: { ...link }, incubator, sendReceipt, notifyIncubator };
      }
    });

    const c = claim as NotifyClaim | null;
    if (!c) return;

    const lang: 'en' | 'fr' = c.link.locale === 'en' ? 'en' : 'fr';
    if (c.sendReceipt) {
      await sendPaymentLinkReceiptEmail({ link: c.link, incubator: c.incubator, lang });
    }
    if (c.notifyIncubator) {
      await sendPaymentLinkPaidIncubatorEmail({ link: c.link, incubator: c.incubator, lang });
    }
  } catch {
    // Notifications are non-critical — swallow so settlement is unaffected.
  }
}

/* ──────────────────────────── Verify / webhook / init ──────────────────────────── */

/**
 * Verify with the provider and settle if paid. Called when the payer returns
 * from the hosted checkout. Never trusts the redirect — asks the provider.
 */
export async function verifyAndSettlePaymentLink(slug: string): Promise<PaymentLinkPayView> {
  const data = await db.read();
  const link = findBySlug(data.paymentLinks, slug);
  if (!link) return { state: 'INVALID' };

  if (link.status === 'PAID') return buildView(data, link, 'PAID');
  if (link.status === 'CANCELLED') return buildView(data, link, 'CANCELLED');

  // No provider reference yet → the payer never started checkout.
  if (!link.providerRef) {
    return buildView(data, link, isExpired(link) ? 'EXPIRED' : 'AWAITING_PAYMENT');
  }

  // Ask the provider directly. Unconfigured (mock/dev) → treat as not-yet-paid.
  let status: { completed: 0 | 1 };
  try {
    status = await getSlickPayTransferStatus(link.providerRef);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return buildView(data, link, isExpired(link) ? 'EXPIRED' : 'AWAITING_PAYMENT');
    }
    throw err;
  }

  if (status.completed !== 1) {
    return buildView(data, link, isExpired(link) ? 'EXPIRED' : 'AWAITING_PAYMENT');
  }

  await applyPaymentLinkSettlement(link.id, link.providerRef);
  void dispatchPaymentLinkNotificationsIfDue(link.id);
  const after = (await db.read());
  const updated = findBySlug(after.paymentLinks, slug) ?? link;
  return buildView(after, updated, 'PAID');
}

/**
 * Settle a payment link from a SIGNATURE-VERIFIED provider webhook. Unlike the
 * return-page path it does not re-poll — the webhook is already authenticated.
 * `id` is the provider `external_id` we set at init (= link.id). Idempotent
 * (delegates to applyPaymentLinkSettlement); safe to replay.
 */
export async function settlePaymentLinkFromWebhook(
  id: string,
  providerRef: string | null,
  status: 'COMPLETED' | 'FAILED',
): Promise<'SETTLED' | 'ALREADY' | 'NOT_FOUND' | 'IGNORED'> {
  const data = await db.read();
  const link = (data.paymentLinks ?? []).find((l) => l.id === id);
  if (!link) return 'NOT_FOUND';
  if (status !== 'COMPLETED') return 'IGNORED';
  if (link.status === 'PAID') return 'ALREADY';
  const outcome = await applyPaymentLinkSettlement(id, providerRef);
  if (outcome.kind === 'NOT_FOUND') return 'NOT_FOUND';
  // The link was cancelled mid-checkout: the payer paid but the link can no
  // longer be settled. Acknowledge so the provider stops retrying — the money
  // must be refunded MANUALLY (the wallet was never credited). Mirrors the
  // card-booking SLOT_TAKEN handling.
  if (outcome.kind === 'CANCELLED') return 'IGNORED';
  void dispatchPaymentLinkNotificationsIfDue(id);
  return 'SETTLED';
}

export type InitPaymentLinkResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; reason: PaymentLinkPayState | 'PROVIDER_FAILED'; message?: string };

/**
 * Create the hosted-checkout transfer lazily (only when the payer clicks Pay).
 * Freezes the payer's name/email and the payer-side fee, charges
 * `amount + payerFee`, and returns the URL to redirect to. A synchronous
 * provider (mock sync) settles immediately.
 */
export async function initPaymentLinkPayment(
  slug: string,
  payer: { payerName: string; payerEmail: string },
  appBaseUrl: string,
  locale: string,
): Promise<InitPaymentLinkResult> {
  const data = await db.read();
  const link = findBySlug(data.paymentLinks, slug);
  if (!link) return { ok: false, reason: 'INVALID' };
  if (link.status === 'PAID') return { ok: false, reason: 'PAID' };
  if (link.status === 'CANCELLED') return { ok: false, reason: 'CANCELLED' };
  if (link.status === 'EXPIRED' || isExpired(link)) return { ok: false, reason: 'EXPIRED' };

  const base = link.amount;
  if (base <= 0) return { ok: false, reason: 'PROVIDER_FAILED', message: 'Nothing to charge' };

  const incubator = (data.incubators ?? []).find((i) => i.id === link.incubatorId) ?? null;
  const quote = quoteCommission({
    transactionType: 'PAYMENT',
    providerPlan: planFor(incubator),
    baseAmount: base,
    config: data.meta?.platformConfig,
  });
  const grossCharge = quote.grossChargedToPayer;

  const root = appBaseUrl.replace(/\/$/, '');
  const localeSeg = locale || 'fr';
  const returnUrl = `${root}/${localeSeg}/pay/${slug}`;

  const provider = getActiveProvider();
  let result;
  try {
    result = await provider.initTopUp({
      topUpId: link.id,
      userId: `guest:${link.id}`,
      amount: grossCharge,
      returnUrl,
      webhookUrl: `${root}/api/webhooks/payments/${provider.code}`,
      customer: {
        fullName: payer.payerName,
        email: payer.payerEmail,
        phone: '',
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'PROVIDER_FAILED',
      message: err instanceof Error ? err.message : 'Payment provider error',
    };
  }

  // Freeze payer details + fee + provider reference so the return verification
  // can poll it and the receipt reflects exactly what was charged.
  await db.update((d) => {
    const l = (d.paymentLinks ?? []).find((x) => x.id === link.id);
    if (l && l.status === 'ACTIVE') {
      l.payerName = payer.payerName;
      l.payerEmail = payer.payerEmail;
      l.payerFeeAmount = quote.payerFee;
      l.payerFeeRate = quote.payerRate;
      l.grossChargedToPayer = grossCharge;
      l.locale = localeSeg;
      l.providerRef = result.providerRef;
      l.updatedAt = new Date().toISOString();
    }
  });

  // Synchronous settlement (mock sync) → settle now, bounce to the pay page.
  if (result.status === 'COMPLETED') {
    await applyPaymentLinkSettlement(link.id, result.providerRef);
    void dispatchPaymentLinkNotificationsIfDue(link.id);
    return { ok: true, redirectUrl: returnUrl };
  }

  if (result.status === 'FAILED' || !result.redirectUrl) {
    return { ok: false, reason: 'PROVIDER_FAILED', message: 'Could not start the payment session' };
  }

  return { ok: true, redirectUrl: result.redirectUrl };
}

/**
 * Reconcile links that were paid online but never settled (payer closed the tab
 * after paying; no webhook). Re-verifies each via the provider (poll) and
 * settles idempotently. Only touches ACTIVE links with a providerRef idle for
 * at least `olderThanMs`.
 */
export async function reconcilePendingPaymentLinks(
  opts: { olderThanMs?: number; limit?: number } = {},
): Promise<{ checked: number; settled: number }> {
  const olderThanMs = opts.olderThanMs ?? 5 * 60_000;
  const limit = opts.limit ?? 200;
  const cutoff = Date.now() - olderThanMs;
  const data = await db.read();
  const candidates = (data.paymentLinks ?? [])
    .filter(
      (l) =>
        l.status === 'ACTIVE' &&
        !!l.providerRef &&
        Date.parse(l.updatedAt) <= cutoff,
    )
    .slice(0, limit);

  let settled = 0;
  for (const l of candidates) {
    const view = await verifyAndSettlePaymentLink(l.slug);
    if (view.state === 'PAID') settled += 1;
  }
  return { checked: candidates.length, settled };
}
