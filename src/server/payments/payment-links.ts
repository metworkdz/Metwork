/**
 * Direct payment links — an incubator or (Metwork 2.0) a freelancer invoices
 * a client who does NOT need a Metwork account. Amounts are DZD only. The incubator shares a public `/pay/<slug>` URL; the payer
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
 *
 * Freelancer links (`freelancerId`) run through the SAME settlement, claim and
 * notifications; only the receiver differs (see `receiverOf`): the base lands
 * in the freelancer's own wallet, and the receiver commission is their plan's
 * payment-link fee from the entitlements table (Free 3 %, Premium 0 %),
 * resolved at settlement like an incubator's plan. The payer fee is the same.
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
  type PaymentLinkIssuer,
} from '@/server/notifications/mock';
import { entitlementsForUser } from '@/lib/entitlements';
import { createNotification } from '@/server/notifications/create-notification';
import type { CommissionQuote } from '@/server/payments/commission';
import { applyOrderPaymentInDraft, orderCommissionRate, type OrderPaymentEvent } from '@/server/orders/state';

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

type StoreRead = Awaited<ReturnType<typeof db.read>>;

/** Who a link pays — THE one place that knows a link can belong to either. */
interface LinkReceiver {
  kind: 'INCUBATOR' | 'FREELANCER';
  /** The wallet that receives the base (incubator manager, or the freelancer). */
  walletUserId: string | null;
  /** Letterhead for the pay page, the receipt and the "paid" notice. */
  issuer: PaymentLinkIssuer;
  incubator: IncubatorRecord | null;
  /** Freelancers only: the receiver rate from their plan (0–1). */
  receiverRate?: number;
  walletPath: string;
}

function receiverOf(d: StoreDraft | StoreRead, link: PaymentLinkRecord): LinkReceiver | null {
  if (link.freelancerId) {
    const user = d.users.find((u) => u.id === link.freelancerId && u.role === 'FREELANCER');
    if (!user) return null;
    const settings = (d.freelancerProfiles ?? []).find((p) => p.userId === user.id)?.invoiceSettings ?? {};
    const ent = entitlementsForUser(user);
    // An order's link carries the sourced-work commission frozen on the order
    // (approved: it REPLACES the plan's link fee, it is not added to it).
    const orderRate = orderCommissionRate(d, link);
    return {
      kind: 'FREELANCER',
      walletUserId: user.id,
      incubator: null,
      receiverRate: orderRate ?? (ent?.paymentLinkFeePercent ?? 3) / 100,
      walletPath: '/dashboard/freelancer/wallet',
      issuer: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        city: user.city,
        logoUrl: settings.invoiceLogoUrl ?? null,
        stampUrl: settings.invoiceStampUrl ?? null,
        address: settings.address ?? null,
        registrationNumber: settings.invoiceRegNumber ?? null,
        commercialRegNumber: null,
        nif: settings.nif ?? null,
      },
    };
  }
  const inc = (d.incubators ?? []).find((i) => i.id === link.incubatorId) ?? null;
  if (!inc) return null;
  return { kind: 'INCUBATOR', walletUserId: inc.managerId ?? null, incubator: inc, issuer: inc, walletPath: '/dashboard/incubator/wallet' };
}

/**
 * The commission quote for a link. Incubators: their plan through the central
 * engine. Freelancers: the engine's payer fee, with the receiver cut replaced
 * by their plan's link fee — the same rounding, the same derived totals.
 */
function quoteFor(d: StoreDraft | StoreRead, link: PaymentLinkRecord): CommissionQuote {
  const receiver = receiverOf(d, link);
  const quote = quoteCommission({
    transactionType: 'PAYMENT',
    providerPlan: planFor(receiver?.incubator),
    baseAmount: link.amount,
    config: d.meta?.platformConfig,
  });
  if (receiver?.kind !== 'FREELANCER') return quote;
  const base = Math.max(0, Math.round(link.amount));
  const receiverRate = Math.min(1, Math.max(0, receiver.receiverRate ?? 0));
  const receiverCommission = Math.round(base * receiverRate);
  return {
    ...quote,
    receiverRate,
    receiverCommission,
    netToProviderWallet: base - receiverCommission,
    platformTake: receiverCommission + quote.payerFee,
  };
}

/** What a payer is charged for a link (base + payer fee) — the same quote checkout uses. */
export function payerGrossFor(d: StoreRead, link: PaymentLinkRecord): number {
  return link.grossChargedToPayer ?? quoteFor(d, link).grossChargedToPayer;
}

/* ──────────────────────────── Incubator-facing CRUD ──────────────────────────── */

export interface CreatePaymentLinkInput {
  /** Exactly one of incubatorId / freelancerId. */
  incubatorId?: string;
  freelancerId?: string;
  serviceName: string;
  amount: number;
  description?: string | null;
  hasExpiry: boolean;
  /** Required when hasExpiry — ISO date string. */
  expiresAt?: string | null;
  /** Hiring orders only (`server/orders`). */
  orderId?: string | null;
  orderPart?: 'DEPOSIT' | 'BALANCE' | null;
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
      ...(input.freelancerId ? { freelancerId: input.freelancerId } : { incubatorId: input.incubatorId }),
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
      ...(input.orderId ? { orderId: input.orderId, orderPart: input.orderPart ?? null } : {}),
      createdAt: now,
      paidAt: null,
      updatedAt: now,
    };
    d.paymentLinks.push(link);
    return link;
  });
}

/** Whose links: an incubator (by id) or a freelancer (by user id). */
export type PaymentLinkOwner = { incubatorId: string } | { freelancerId: string };

function ownsLink(link: PaymentLinkRecord, owner: PaymentLinkOwner): boolean {
  return 'freelancerId' in owner
    ? !link.incubatorId && link.freelancerId === owner.freelancerId
    : !link.freelancerId && link.incubatorId === owner.incubatorId;
}

/** All of an owner's links, newest first. A bare string is an incubator id. */
export async function listPaymentLinks(owner: string | PaymentLinkOwner): Promise<PaymentLinkRecord[]> {
  const o: PaymentLinkOwner = typeof owner === 'string' ? { incubatorId: owner } : owner;
  const data = await db.read();
  return (data.paymentLinks ?? [])
    .filter((l) => ownsLink(l, o))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type CancelPaymentLinkResult =
  | { ok: true; link: PaymentLinkRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_PAID' | 'ORDER_LINK' };

/**
 * Cancel a link — only while it has not been PAID. Idempotent: cancelling an
 * already-CANCELLED (or EXPIRED) link is a no-op success. Ownership is enforced
 * by requiring the caller's incubatorId to match.
 */
export async function cancelPaymentLink(
  id: string,
  owner: string | PaymentLinkOwner,
): Promise<CancelPaymentLinkResult> {
  const o: PaymentLinkOwner = typeof owner === 'string' ? { incubatorId: owner } : owner;
  return db.update<CancelPaymentLinkResult>((d) => {
    const link = (d.paymentLinks ?? []).find((l) => l.id === id && ownsLink(l, o));
    if (!link) return { ok: false, reason: 'NOT_FOUND' };
    if (link.status === 'PAID') return { ok: false, reason: 'ALREADY_PAID' };
    // An order's link is cancelled with the order, never on its own.
    if (link.orderId) return { ok: false, reason: 'ORDER_LINK' };
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
  const receiver = receiverOf(data, link);
  // Fee preview/frozen. Once frozen at init we show the locked values; before
  // that we preview against the receiver's current plan + config.
  let payerFee = link.payerFeeAmount ?? 0;
  let grossCharge = link.grossChargedToPayer ?? 0;
  if (link.grossChargedToPayer == null) {
    const quote = quoteFor(data, link);
    payerFee = quote.payerFee;
    grossCharge = quote.grossChargedToPayer;
  }
  return {
    state,
    link,
    // Named `incubator` for the pay page's existing contract: it is the receiver.
    incubator: receiver
      ? { name: receiver.issuer.name, logoUrl: receiver.issuer.logoUrl ?? null, city: receiver.issuer.city ?? null }
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
  | { kind: 'SETTLED'; link: PaymentLinkRecord; claimed: boolean; order?: OrderPaymentEvent }
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
  const outcome = await db.update<SettleOutcome>((d) => {
    const link = (d.paymentLinks ?? []).find((l) => l.id === id);
    if (!link) return { kind: 'NOT_FOUND' };

    if (link.status === 'PAID') return { kind: 'SETTLED', link, claimed: false };
    if (link.status === 'CANCELLED') return { kind: 'CANCELLED', link };

    return settleLinkInDraft(d, link, providerRef);
  });
  if (outcome.kind === 'SETTLED' && outcome.claimed && outcome.order) void notifyOrderPayment(outcome.order);
  return outcome;
}

/** Order notices load lazily: the order module imports this one. */
async function notifyOrderPayment(event: NonNullable<OrderPaymentEvent>): Promise<void> {
  try {
    const { notifyOrderPaid } = await import('@/server/orders/service');
    await notifyOrderPaid(event);
  } catch (err) {
    console.error('[orders] payment notice failed', String(err));
  }
}

/**
 * The PAID claim and the money movement, inside a caller's mutation. Shared
 * by the provider paths (card) and the wallet path, so both settle the same
 * way. The caller has already checked the link is ACTIVE.
 */
function settleLinkInDraft(d: StoreDraft, link: PaymentLinkRecord, providerRef: string | null): SettleOutcome {
  const now = new Date().toISOString();

  // ── Claim the PAID transition ─────────────────────────────────────────
  link.status = 'PAID';
  link.paidAt = now;
  if (providerRef) link.providerRef = providerRef;
  link.updatedAt = now;

  // ── Commission (central engine) on the base amount ────────────────────
  const receiver = receiverOf(d, link);
  const walletUserId = receiver?.walletUserId ?? null;
  const base = link.amount;
  const quote = quoteFor(d, link);
  const commission = quote.receiverCommission;
  link.commissionRate = quote.receiverRate;
  link.commissionAmount = commission;
  // Freeze the payer fee too if init never recorded it (defensive).
  if (link.payerFeeAmount == null) {
    link.payerFeeAmount = quote.payerFee;
    link.payerFeeRate = quote.payerRate;
    link.grossChargedToPayer = quote.grossChargedToPayer;
  }

  // ── Receiver wallet: +base (PAYOUT), −commission (COMMISSION) ──────────
  if (walletUserId) {
    const wallet = ensureWallet(d, walletUserId);
    if (base > 0 && wallet.status !== 'FROZEN') {
      wallet.balance += base;
      wallet.updatedAt = now;
      const payoutTx: TransactionRecord = {
        id: newSlug(),
        walletId: wallet.id,
        userId: walletUserId,
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
        userId: walletUserId,
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

  const order = applyOrderPaymentInDraft(d, link, now);
  return { kind: 'SETTLED', link, claimed: true, order };
}

/* ──────────────────────────── Notifications ──────────────────────────── */

interface NotifyClaim {
  link: PaymentLinkRecord;
  incubator: PaymentLinkIssuer;
  walletPath: string;
  /** In-app + push "payment received" to the wallet owner (not for order links: orders notify themselves). */
  notifyUser: { id: string; locale: string | null } | null;
  sendReceipt: boolean;
  notifyIncubator: boolean;
}

const dzd = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} DA`;
const PAID_TITLE: Record<'fr' | 'en' | 'ar', (amount: number) => string> = {
  fr: (a) => `Paiement reçu · ${dzd(a)}`,
  en: (a) => `Payment received · ${dzd(a)}`,
  ar: (a) => `تم استلام دفعة · ${dzd(a)}`,
};

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
      const receiver = receiverOf(d, link);
      if (!receiver) return;

      const now = new Date().toISOString();
      const sendReceipt = !link.paidReceiptSentAt && !!link.payerEmail;
      const notifyIncubator = !link.incubatorNotifiedAt;
      if (sendReceipt) link.paidReceiptSentAt = now;
      if (notifyIncubator) link.incubatorNotifiedAt = now;
      if (sendReceipt || notifyIncubator) {
        const owner = notifyIncubator && !link.orderId && receiver.walletUserId ? d.users.find((u) => u.id === receiver.walletUserId) : undefined;
        claim = {
          link: { ...link },
          incubator: receiver.issuer,
          walletPath: receiver.walletPath,
          sendReceipt,
          notifyIncubator,
          notifyUser: owner ? { id: owner.id, locale: owner.locale ?? null } : null,
        };
      }
    });

    const c = claim as NotifyClaim | null;
    if (!c) return;

    const lang: 'en' | 'fr' = c.link.locale === 'en' ? 'en' : 'fr';
    if (c.sendReceipt) {
      await sendPaymentLinkReceiptEmail({ link: c.link, incubator: c.incubator, lang });
    }
    if (c.notifyIncubator) {
      await sendPaymentLinkPaidIncubatorEmail({ link: c.link, incubator: c.incubator, lang, walletPath: c.walletPath });
    }
    if (c.notifyUser) {
      const l = c.notifyUser.locale === 'en' || c.notifyUser.locale === 'ar' ? c.notifyUser.locale : 'fr';
      await createNotification({
        userId: c.notifyUser.id,
        type: 'WALLET_CREDITED',
        title: PAID_TITLE[l](c.link.amount),
        body: [c.link.payerName, c.link.description].filter(Boolean).join(' · ').slice(0, 200),
        href: c.walletPath,
      });
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

  const quote = quoteFor(data, link);
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

/* ──────────────────────────── Wallet payment (orders) ──────────────────────────── */

export type WalletPayResult =
  | { ok: true; link: PaymentLinkRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PAYABLE' | 'NO_WALLET' | 'INSUFFICIENT_FUNDS' | 'WALLET_FROZEN' };

/**
 * Pay an ACTIVE link from a member's Metwork wallet: debit the payer the same
 * gross a card payer would be charged (base + payer fee), then settle exactly
 * like a card payment — one mutation, so the debit and the credit happen
 * together or not at all. Only for links the caller is allowed to pay
 * (checked by the order service before calling).
 */
export async function payLinkFromWallet(linkId: string, payerUserId: string): Promise<WalletPayResult> {
  // Validate before mutating: db.update has no rollback.
  const before = await db.read();
  const l0 = (before.paymentLinks ?? []).find((l) => l.id === linkId);
  if (!l0) return { ok: false, reason: 'NOT_FOUND' };
  if (l0.status !== 'ACTIVE' || isExpired(l0)) return { ok: false, reason: 'NOT_PAYABLE' };
  const w0 = before.wallets.find((w) => w.userId === payerUserId);
  if (!w0) return { ok: false, reason: 'NO_WALLET' };
  if (w0.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
  if (w0.balance < quoteFor(before, l0).grossChargedToPayer) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };

  const outcome = await db.update<WalletPayResult & { order?: OrderPaymentEvent }>((d) => {
    const link = (d.paymentLinks ?? []).find((l) => l.id === linkId);
    if (!link) return { ok: false, reason: 'NOT_FOUND' };
    // Re-checked under the lock: a concurrent payment may have claimed it.
    if (link.status !== 'ACTIVE' || isExpired(link)) return { ok: false, reason: 'NOT_PAYABLE' };
    const payer = d.users.find((u) => u.id === payerUserId);
    const wallet = d.wallets.find((w) => w.userId === payerUserId);
    if (!payer || !wallet) return { ok: false, reason: 'NO_WALLET' };
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };
    const quote = quoteFor(d, link);
    const gross = quote.grossChargedToPayer;
    if (wallet.balance < gross) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };

    const now = new Date().toISOString();
    wallet.balance -= gross;
    wallet.updatedAt = now;
    d.transactions.push({
      id: newSlug(),
      walletId: wallet.id,
      userId: payerUserId,
      type: 'PAYMENT',
      amount: -gross,
      balanceAfter: wallet.balance,
      status: 'COMPLETED',
      description: link.serviceName,
      reference: `wallet-link-${link.id}`,
      provider: 'wallet',
      providerTxnId: null,
      metadata: { paymentLinkId: link.id, orderId: link.orderId ?? null, base: link.amount, payerFee: quote.payerFee },
      createdAt: now,
      completedAt: now,
    });
    link.payerName = payer.fullName;
    link.payerEmail = payer.email;
    link.payerFeeAmount = quote.payerFee;
    link.payerFeeRate = quote.payerRate;
    link.grossChargedToPayer = gross;
    link.locale = payer.locale ?? 'fr';
    const settled = settleLinkInDraft(d, link, `wallet:${wallet.id}`);
    return settled.kind === 'SETTLED'
      ? { ok: true, link: { ...settled.link }, order: settled.order }
      : { ok: false, reason: 'NOT_PAYABLE' };
  });
  if (outcome.ok) {
    if (outcome.order) void notifyOrderPayment(outcome.order);
    void dispatchPaymentLinkNotificationsIfDue(linkId);
    return { ok: true, link: outcome.link };
  }
  return outcome;
}
