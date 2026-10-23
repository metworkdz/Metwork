/**
 * Hiring orders — THE service for work ordered through Metwork (Metwork 2.0
 * phase 7b, approved model):
 *
 *   founder orders a gig, or accepts a devis in a conversation
 *     → order AWAITING_DEPOSIT + a 50 % deposit link
 *   deposit paid (card on /pay, or wallet)          → IN_PROGRESS
 *   freelancer marks it delivered                    → DELIVERED + balance link
 *   balance paid                                     → COMPLETED → one review
 *
 * Money only ever moves through the payment-link settlement (single-use,
 * idempotent), which also advances the order in the same mutation
 * (`orders/state`). No escrow: each payment reaches the freelancer's wallet
 * at once, minus the sourced-work commission frozen on the order at creation
 * (10 % Free / 7 % Premium) — which replaces the plan's link fee.
 */
import { randomUUID } from 'node:crypto';
import { db, type ServiceOrderRecord, type ServiceOrderStatus } from '@/server/db/store';
import { entitlementsForUser } from '@/lib/entitlements';
import { isListed } from '@/server/hiring/directory';
import { ownsInvoice } from '@/server/invoices/owner';
import { createPaymentLink, payerGrossFor, payLinkFromWallet, type WalletPayResult } from '@/server/payments/payment-links';
import { messagingRepo } from '@/server/messaging/repo';
import { canMessage, sendMessage, startConversation, type MessagingError } from '@/server/messaging/service';
import { createNotification } from '@/server/notifications/create-notification';
import { sendOrderNotice } from '@/server/notifications/mock';
import type { OrderPaymentEvent } from '@/server/orders/state';

export { reviewsOf } from '@/server/orders/reviews';

type Store = Awaited<ReturnType<typeof db.read>>;

/** Smallest order: below this a 50/50 split makes no sense. */
export const MIN_ORDER_DZD = 1000;

export function splitAmounts(total: number): { deposit: number; balance: number } {
  const deposit = Math.ceil(total / 2);
  return { deposit, balance: total - deposit };
}

function nextNumber(d: Store, now: string): string {
  const year = now.slice(0, 4);
  const prefix = `CMD-${year}-`;
  const max = (d.serviceOrders ?? [])
    .filter((o) => o.number.startsWith(prefix))
    .reduce((m, o) => Math.max(m, Number(o.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export type OrderError =
  | 'NOT_FOUND'
  | 'NOT_ALLOWED'
  | 'BLOCKED'
  | 'ALREADY_ORDERED'
  | 'TOO_SMALL'
  | 'WRONG_STATUS'
  | 'ALREADY_REVIEWED'
  | MessagingError
  | Exclude<WalletPayResult, { ok: true }>['reason'];

export type OrderResult<T = ServiceOrderRecord> = { ok: true; value: T } | { ok: false; reason: OrderError };

/* ─────────────────────────── Create ─────────────────────────── */

async function createOrder(
  data: Store,
  input: Pick<ServiceOrderRecord, 'entrepreneurId' | 'freelancerId' | 'source' | 'title' | 'total' | 'conversationId'>,
): Promise<ServiceOrderRecord> {
  const freelancer = data.users.find((u) => u.id === input.freelancerId)!;
  const ent = entitlementsForUser(freelancer);
  const commissionRate = (ent?.audience === 'FREELANCER' ? ent.sourcedCommissionPercent : 10) / 100;
  const { deposit, balance } = splitAmounts(input.total);
  const now = new Date().toISOString();
  const id = randomUUID();

  const order = await db.update((d) => {
    const o: ServiceOrderRecord = {
      id,
      number: nextNumber(d, now),
      ...input,
      depositAmount: deposit,
      balanceAmount: balance,
      commissionRate,
      depositLinkId: null,
      balanceLinkId: null,
      status: 'AWAITING_DEPOSIT',
      depositPaidAt: null,
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      review: null,
      createdAt: now,
      updatedAt: now,
    };
    (d.serviceOrders ??= []).push(o);
    return o;
  });
  const link = await createPaymentLink({
    freelancerId: input.freelancerId,
    serviceName: `${order.number} — ${input.title} (50 %)`,
    amount: deposit,
    hasExpiry: false,
    orderId: id,
    orderPart: 'DEPOSIT',
  });
  return db.update((d) => {
    const o = d.serviceOrders!.find((x) => x.id === id)!;
    o.depositLinkId = link.id;
    return { ...o };
  });
}

async function checkParties(data: Store, founderId: string, freelancerId: string): Promise<OrderError | null> {
  const founder = data.users.find((u) => u.id === founderId);
  if (!founder || founder.role !== 'ENTREPRENEUR' || !canMessage(founder)) return 'NOT_ALLOWED';
  if (!isListed(data, freelancerId)) return 'NOT_FOUND';
  if (await messagingRepo().isBlockedEitherWay(founderId, freelancerId)) return 'BLOCKED';
  return null;
}

/** Order a live gig at its listed price. Opens (or reuses) the gig conversation with an order card. */
export async function orderGig(founderId: string, gigId: string, intro: string): Promise<OrderResult> {
  const data = await db.read();
  const gig = (data.gigs ?? []).find((g) => g.id === gigId && g.isActive);
  if (!gig) return { ok: false, reason: 'NOT_FOUND' };
  const refused = await checkParties(data, founderId, gig.freelancerId);
  if (refused) return { ok: false, reason: refused };
  if (gig.price < MIN_ORDER_DZD) return { ok: false, reason: 'TOO_SMALL' };

  const order = await createOrder(data, {
    entrepreneurId: founderId,
    freelancerId: gig.freelancerId,
    source: { type: 'GIG', gigId },
    title: gig.title,
    total: gig.price,
    conversationId: null,
  });
  const conv = await startConversation({
    fromId: founderId,
    toId: gig.freelancerId,
    contextType: 'GIG_ORDER',
    contextId: gigId,
    body: intro,
    attachment: { kind: 'ORDER', orderId: order.id },
  });
  if (!conv.ok) {
    // The thread could not be opened (e.g. weekly contact limit): withdraw the order.
    await cancelInDraft(order.id, founderId);
    return { ok: false, reason: conv.reason };
  }
  return { ok: true, value: await setConversation(order.id, conv.value.conversationId) };
}

/** Accept a devis the freelancer shared in a conversation: it becomes an order. */
export async function acceptDevis(founderId: string, conversationId: string, invoiceId: string): Promise<OrderResult> {
  const conv = await messagingRepo().getConversation(conversationId);
  if (!conv || !conv.participants.some((p) => p.userId === founderId)) return { ok: false, reason: 'NOT_FOUND' };
  const freelancerId = conv.participants.find((p) => p.userId !== founderId)?.userId;
  if (!freelancerId) return { ok: false, reason: 'NOT_FOUND' };
  // Only a devis really sent in this thread, by the other person.
  const msgs = await messagingRepo().messages(conversationId, { limit: 1000 });
  if (!msgs.some((m) => m.senderId === freelancerId && m.attachment?.kind === 'INVOICE' && m.attachment.invoiceId === invoiceId)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  const data = await db.read();
  const inv = (data.invoices ?? []).find((i) => i.id === invoiceId);
  if (!inv || (inv.kind ?? 'FACTURE') !== 'DEVIS' || inv.status === 'CANCELLED' || !ownsInvoice(inv, { type: 'FREELANCER', id: freelancerId })) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if ((data.serviceOrders ?? []).some((o) => o.source.type === 'QUOTE' && o.source.invoiceId === invoiceId && o.status !== 'CANCELLED')) {
    return { ok: false, reason: 'ALREADY_ORDERED' };
  }
  const refused = await checkParties(data, founderId, freelancerId);
  if (refused) return { ok: false, reason: refused };
  const total = Math.round(inv.totals.net);
  if (total < MIN_ORDER_DZD) return { ok: false, reason: 'TOO_SMALL' };

  const quoteId = conv.contextType === 'QUOTE_REQUEST' ? conv.contextId : null;
  const order = await createOrder(data, {
    entrepreneurId: founderId,
    freelancerId,
    source: { type: 'QUOTE', invoiceId, quoteId },
    title: `${inv.number}${quoteId ? ` — ${(data.quoteRequests ?? []).find((q) => q.id === quoteId)?.title ?? ''}` : ''}`.trim().replace(/ —\s*$/, ''),
    total,
    conversationId,
  });
  if (quoteId) {
    await db.update((d) => {
      const q = d.quoteRequests?.find((x) => x.id === quoteId);
      if (q) { q.status = 'CLOSED'; q.updatedAt = new Date().toISOString(); }
    });
  }
  await sendMessage({ userId: founderId, conversationId, body: '', attachment: { kind: 'ORDER', orderId: order.id } });
  return { ok: true, value: order };
}

async function setConversation(orderId: string, conversationId: string): Promise<ServiceOrderRecord> {
  return db.update((d) => {
    const o = d.serviceOrders!.find((x) => x.id === orderId)!;
    o.conversationId = conversationId;
    return { ...o };
  });
}

/* ─────────────────────────── Lifecycle ─────────────────────────── */

const partyOf = (o: ServiceOrderRecord, userId: string) =>
  o.entrepreneurId === userId ? 'FOUNDER' : o.freelancerId === userId ? 'FREELANCER' : null;

/** Cancel before the deposit is paid — either side. After that, it goes through support. */
export async function cancelOrder(userId: string, orderId: string): Promise<OrderResult> {
  const data = await db.read();
  const o = (data.serviceOrders ?? []).find((x) => x.id === orderId);
  if (!o || !partyOf(o, userId)) return { ok: false, reason: 'NOT_FOUND' };
  if (o.status !== 'AWAITING_DEPOSIT') return { ok: false, reason: 'WRONG_STATUS' };
  const r = await cancelInDraft(orderId, userId);
  return r ? { ok: true, value: r } : { ok: false, reason: 'WRONG_STATUS' };
}

async function cancelInDraft(orderId: string, userId: string): Promise<ServiceOrderRecord | null> {
  return db.update((d) => {
    const o = d.serviceOrders?.find((x) => x.id === orderId);
    // Re-checked under the lock: the deposit may have just been paid.
    if (!o || o.status !== 'AWAITING_DEPOSIT') return null;
    const link = d.paymentLinks?.find((l) => l.id === o.depositLinkId);
    if (link?.status === 'PAID') return null;
    const now = new Date().toISOString();
    if (link && link.status === 'ACTIVE') { link.status = 'CANCELLED'; link.updatedAt = now; }
    o.status = 'CANCELLED';
    o.cancelledAt = now;
    o.cancelledBy = userId;
    o.updatedAt = now;
    return { ...o };
  });
}

/** The freelancer delivers: the balance link is created and the founder is asked to pay it. */
export async function markDelivered(freelancerId: string, orderId: string): Promise<OrderResult> {
  const data = await db.read();
  const o = (data.serviceOrders ?? []).find((x) => x.id === orderId && x.freelancerId === freelancerId);
  if (!o) return { ok: false, reason: 'NOT_FOUND' };
  if (o.status !== 'IN_PROGRESS') return { ok: false, reason: 'WRONG_STATUS' };
  // Claim the transition first, so two clicks never create two balance links.
  const claimed = await db.update((d) => {
    const x = d.serviceOrders!.find((y) => y.id === orderId)!;
    if (x.status !== 'IN_PROGRESS') return false;
    const now = new Date().toISOString();
    x.status = 'DELIVERED';
    x.deliveredAt = now;
    x.updatedAt = now;
    return true;
  });
  if (!claimed) return { ok: false, reason: 'WRONG_STATUS' };
  const link = await createPaymentLink({
    freelancerId,
    serviceName: `${o.number} — ${o.title} (solde)`,
    amount: o.balanceAmount,
    hasExpiry: false,
    orderId,
    orderPart: 'BALANCE',
  });
  const order = await db.update((d) => {
    const x = d.serviceOrders!.find((y) => y.id === orderId)!;
    x.balanceLinkId = link.id;
    return { ...x };
  });
  if (order.conversationId) {
    await sendMessage({ userId: freelancerId, conversationId: order.conversationId, body: '', attachment: { kind: 'ORDER', orderId } }).catch(() => undefined);
  }
  return { ok: true, value: order };
}

/** The founder pays the part that is due from their Metwork wallet. */
export async function payOrderFromWallet(founderId: string, orderId: string): Promise<OrderResult> {
  const data = await db.read();
  const o = (data.serviceOrders ?? []).find((x) => x.id === orderId && x.entrepreneurId === founderId);
  if (!o) return { ok: false, reason: 'NOT_FOUND' };
  const linkId = o.status === 'AWAITING_DEPOSIT' ? o.depositLinkId : o.status === 'DELIVERED' ? o.balanceLinkId : null;
  if (!linkId) return { ok: false, reason: 'WRONG_STATUS' };
  const r = await payLinkFromWallet(linkId, founderId);
  if (!r.ok) return { ok: false, reason: r.reason };
  const after = (await db.read()).serviceOrders!.find((x) => x.id === orderId)!;
  return { ok: true, value: after };
}

/** One review per completed order, by the founder who paid it. */
export async function reviewOrder(founderId: string, orderId: string, rating: number, comment: string | null): Promise<OrderResult> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, reason: 'NOT_ALLOWED' };
  return db.update<OrderResult>((d) => {
    const o = d.serviceOrders?.find((x) => x.id === orderId && x.entrepreneurId === founderId);
    if (!o) return { ok: false, reason: 'NOT_FOUND' };
    if (o.status !== 'COMPLETED') return { ok: false, reason: 'WRONG_STATUS' };
    if (o.review) return { ok: false, reason: 'ALREADY_REVIEWED' };
    const now = new Date().toISOString();
    o.review = { rating, comment: comment?.trim() ? comment.trim().slice(0, 1000) : null, createdAt: now };
    o.updatedAt = now;
    return { ok: true, value: { ...o } };
  });
}

/* ─────────────────────────── Views ─────────────────────────── */

export interface OrderView {
  id: string;
  number: string;
  title: string;
  status: ServiceOrderStatus;
  total: number;
  depositAmount: number;
  balanceAmount: number;
  /** What the viewer does next, if anything. */
  role: 'FOUNDER' | 'FREELANCER';
  other: { id: string; name: string };
  /** Founder: the public pay page of the part due now (card payment). */
  payPath: string | null;
  /** Founder: what the part due costs with the payer fee, from the wallet or by card. */
  dueGross: number | null;
  /** Freelancer: what reaches the wallet for the whole order, after commission. */
  netToFreelancer: number | null;
  commissionPercent: number | null;
  conversationId: string | null;
  review: ServiceOrderRecord['review'];
  createdAt: string;
  depositPaidAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
}

export function orderView(data: Store, o: ServiceOrderRecord, viewerId: string): OrderView | null {
  const role = partyOf(o, viewerId);
  if (!role) return null;
  const otherId = role === 'FOUNDER' ? o.freelancerId : o.entrepreneurId;
  const dueLinkId = o.status === 'AWAITING_DEPOSIT' ? o.depositLinkId : o.status === 'DELIVERED' ? o.balanceLinkId : null;
  const due = dueLinkId ? (data.paymentLinks ?? []).find((l) => l.id === dueLinkId && l.status === 'ACTIVE') : undefined;
  return {
    id: o.id,
    number: o.number,
    title: o.title,
    status: o.status,
    total: o.total,
    depositAmount: o.depositAmount,
    balanceAmount: o.balanceAmount,
    role,
    other: { id: otherId, name: data.users.find((u) => u.id === otherId)?.fullName ?? '—' },
    payPath: role === 'FOUNDER' && due ? `/pay/${due.slug}` : null,
    dueGross: role === 'FOUNDER' && due ? payerGrossFor(data, due) : null,
    netToFreelancer: role === 'FREELANCER' ? o.total - Math.round(o.depositAmount * o.commissionRate) - Math.round(o.balanceAmount * o.commissionRate) : null,
    commissionPercent: role === 'FREELANCER' ? Math.round(o.commissionRate * 100) : null,
    conversationId: o.conversationId,
    review: o.review,
    createdAt: o.createdAt,
    depositPaidAt: o.depositPaidAt,
    deliveredAt: o.deliveredAt,
    completedAt: o.completedAt,
  };
}

export function ordersFor(data: Store, userId: string): OrderView[] {
  return (data.serviceOrders ?? [])
    .filter((o) => o.entrepreneurId === userId || o.freelancerId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((o) => orderView(data, o, userId)!)
    .filter(Boolean);
}

/* ─────────────────────────── Notices ─────────────────────────── */

/** Called after a settlement moved an order (deposit or balance paid). */
export async function notifyOrderPaid(event: NonNullable<OrderPaymentEvent>): Promise<void> {
  const data = await db.read();
  const freelancer = data.users.find((u) => u.id === event.freelancerId);
  const order = (data.serviceOrders ?? []).find((o) => o.id === event.orderId);
  if (!freelancer || !order) return;
  const path = '/dashboard/freelancer/orders';
  await Promise.allSettled([
    createNotification({
      userId: freelancer.id,
      type: 'WALLET_CREDITED',
      title: event.part === 'DEPOSIT' ? 'Acompte reçu' : 'Solde reçu',
      body: `${order.number} — ${order.title}`,
      href: path,
    }),
    sendOrderNotice({
      kind: event.part === 'DEPOSIT' ? 'DEPOSIT_PAID' : 'COMPLETED',
      fullName: freelancer.fullName,
      email: freelancer.email || null,
      phone: freelancer.phone || null,
      locale: freelancer.locale ?? null,
      orderNumber: order.number,
      title: order.title,
      url: `${(process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/$/, '')}/${freelancer.locale === 'ar' || freelancer.locale === 'en' ? freelancer.locale : 'fr'}${path}`,
    }),
  ]);
}
