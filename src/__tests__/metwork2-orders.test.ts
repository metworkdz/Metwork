/**
 * Metwork 2.0 phase 7b — hiring orders. Money-critical:
 *   - 50 % deposit then balance, each through a payment link;
 *   - wallet and card settle the SAME way (one settlement, idempotent);
 *   - the sourced-work commission (10 % Free / 7 % Premium) is frozen on the
 *     order and REPLACES the plan's link fee;
 *   - reviews only on completed (paid) orders.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { createMemoryRepo, setMessagingRepoForTests } from '@/server/messaging/repo';

vi.mock('@/server/notifications/mock', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/server/notifications/mock')),
  sendNewMessageAlert: vi.fn(async () => undefined),
  sendOrderNotice: vi.fn(async () => undefined),
  sendPaymentLinkReceiptEmail: vi.fn(async () => undefined),
  sendPaymentLinkPaidIncubatorEmail: vi.fn(async () => undefined),
}));

const { orderGig, acceptDevis, payOrderFromWallet, markDelivered, cancelOrder, reviewOrder, orderView, splitAmounts } = await import('@/server/orders/service');
const { settlePaymentLinkFromWebhook, cancelPaymentLink } = await import('@/server/payments/payment-links');
const { sendMessage, inbox } = await import('@/server/messaging/service');
const { rankFreelancers } = await import('@/server/hiring/directory');

const T0 = '2026-01-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';
const repo = createMemoryRepo();

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: `Name ${id}`, phone: '+213550000001', city: 'algiers', role, status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}
const profile = (userId: string) => ({
  userId, headline: 'Développeur web', bio: null, skills: ['react', 'next.js', 'site vitrine'], languages: [], remote: true,
  dayRate: null, address: null, portfolio: [], legal: null, createdAt: T0, updatedAt: T0,
}) as never;
const wallet = (userId: string, balance: number) => ({ id: `w-${userId}`, userId, balance, currency: 'DZD', status: 'ACTIVE', createdAt: T0, updatedAt: T0 }) as never;

beforeEach(async () => {
  repo.reset();
  setMessagingRepoForTests(repo);
  await db.update((d) => {
    d.users = [user('en-1', 'ENTREPRENEUR'), user('fl-1', 'FREELANCER'), user('fl-p', 'FREELANCER', { membershipCode: 'FREELANCER_PREMIUM', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE }), user('en-2', 'ENTREPRENEUR')];
    d.freelancerProfiles = [profile('fl-1'), profile('fl-p')];
    d.gigs = [
      { id: 'g-1', freelancerId: 'fl-1', title: 'Site vitrine', description: '', price: 45_001, deliveryDays: 7, revisions: 2, isActive: true, createdAt: T0, updatedAt: T0 } as never,
      { id: 'g-p', freelancerId: 'fl-p', title: 'Landing', description: '', price: 100_000, deliveryDays: 7, revisions: 2, isActive: true, createdAt: T0, updatedAt: T0 } as never,
    ];
    d.wallets = [wallet('en-1', 200_000)];
    d.transactions = [];
    d.paymentLinks = [];
    d.serviceOrders = [];
    d.invoices = [];
    d.quoteRequests = [];
    d.notifications = [];
  });
});

const balanceOf = async (userId: string) => (await db.read()).wallets.find((w) => w.userId === userId)?.balance ?? 0;
const order = async (gigId = 'g-1') => {
  const r = await orderGig('en-1', gigId, 'Bonjour');
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('ordering a gig', () => {
  it('splits 50/50 (deposit rounded up) and opens the deposit link', async () => {
    expect(splitAmounts(45_001)).toEqual({ deposit: 22_501, balance: 22_500 });
    const o = await order();
    const d = await db.read();
    const link = d.paymentLinks!.find((l) => l.id === o.depositLinkId)!;
    expect(o).toMatchObject({ status: 'AWAITING_DEPOSIT', total: 45_001, depositAmount: 22_501, commissionRate: 0.1 });
    expect(link).toMatchObject({ amount: 22_501, orderId: o.id, orderPart: 'DEPOSIT', freelancerId: 'fl-1', status: 'ACTIVE' });
    const th = await inbox('fl-1');
    expect(th[0]!.context).toMatchObject({ type: 'GIG_ORDER', title: 'Site vitrine' });
  });

  it('is refused to a freelancer or a non-founder', async () => {
    expect(await orderGig('fl-p', 'g-1', 'x')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
  });
});

describe('paying', () => {
  it('wallet: debits the founder base + payer fee, credits the freelancer base − 10 %', async () => {
    const o = await order();
    const r = await payOrderFromWallet('en-1', o.id);
    expect(r.ok && r.value.status).toBe('IN_PROGRESS');
    const d = await db.read();
    const link = d.paymentLinks!.find((l) => l.id === o.depositLinkId)!;
    expect(link.status).toBe('PAID');
    expect(await balanceOf('en-1')).toBe(200_000 - link.grossChargedToPayer!);
    expect(link.grossChargedToPayer).toBe(22_501 + link.payerFeeAmount!);
    // Sourced commission REPLACES the 3 % link fee of a Free freelancer.
    expect(link.commissionRate).toBe(0.1);
    expect(await balanceOf('fl-1')).toBe(22_501 - Math.round(22_501 * 0.1));
    // Paying again: nothing is due any more.
    expect(await payOrderFromWallet('en-1', o.id)).toMatchObject({ ok: false, reason: 'WRONG_STATUS' });
  });

  it('wallet: refuses without enough balance and moves nothing', async () => {
    await db.update((d) => { d.wallets[0]!.balance = 1_000; });
    const o = await order();
    expect(await payOrderFromWallet('en-1', o.id)).toMatchObject({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
    expect(await balanceOf('en-1')).toBe(1_000);
    expect((await db.read()).transactions).toHaveLength(0);
  });

  it('card: the provider settlement advances the order, exactly once', async () => {
    const o = await order();
    expect(await settlePaymentLinkFromWebhook(o.depositLinkId!, 'sp-1', 'COMPLETED')).toBe('SETTLED');
    expect(await settlePaymentLinkFromWebhook(o.depositLinkId!, 'sp-1', 'COMPLETED')).toBe('ALREADY');
    const d = await db.read();
    expect(d.serviceOrders![0]!.status).toBe('IN_PROGRESS');
    expect(d.transactions.filter((t) => t.userId === 'fl-1' && t.type === 'PAYOUT')).toHaveLength(1);
  });

  it('Premium: 7 %, frozen at order time even if the plan changes', async () => {
    const o = await order('g-p');
    expect(o.commissionRate).toBe(0.07);
    await db.update((d) => { Object.assign(d.users.find((u) => u.id === 'fl-p')!, { membershipCode: null, membershipTier: 'EXPLORER', membershipExpiresAt: null }); });
    await payOrderFromWallet('en-1', o.id);
    expect(await balanceOf('fl-p')).toBe(50_000 - 3_500);
  });
});

describe('delivery, balance, review', () => {
  it('runs the whole order once, and reviews only after the balance', async () => {
    const o = await order();
    expect(await markDelivered('fl-1', o.id)).toMatchObject({ ok: false, reason: 'WRONG_STATUS' });
    await payOrderFromWallet('en-1', o.id);
    expect(await reviewOrder('en-1', o.id, 5, 'Top')).toMatchObject({ ok: false, reason: 'WRONG_STATUS' });
    const [a, b] = await Promise.all([markDelivered('fl-1', o.id), markDelivered('fl-1', o.id)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const d1 = await db.read();
    expect(d1.paymentLinks!.filter((l) => l.orderId === o.id && l.orderPart === 'BALANCE')).toHaveLength(1);
    const done = await payOrderFromWallet('en-1', o.id);
    expect(done.ok && done.value.status).toBe('COMPLETED');
    expect(await balanceOf('fl-1')).toBe(45_001 - Math.round(22_501 * 0.1) - Math.round(22_500 * 0.1));
    expect((await reviewOrder('en-1', o.id, 5, 'Rapide et soigné')).ok).toBe(true);
    expect(await reviewOrder('en-1', o.id, 1, 'again')).toMatchObject({ ok: false, reason: 'ALREADY_REVIEWED' });
    const card = rankFreelancers(await db.read(), null).find((r) => r.card.id === 'fl-1')!.card;
    expect(card).toMatchObject({ rating: 5, reviewCount: 1 });
  });

  it('is private to its two parties', async () => {
    const o = await order();
    const d = await db.read();
    expect(orderView(d, d.serviceOrders![0]!, 'en-2')).toBeNull();
    expect(await payOrderFromWallet('en-2', o.id)).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(await markDelivered('fl-p', o.id)).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(orderView(d, d.serviceOrders![0]!, 'fl-1')).toMatchObject({ role: 'FREELANCER', payPath: null, commissionPercent: 10 });
  });
});

describe('cancelling', () => {
  it('only before the deposit, and the link goes with the order', async () => {
    const o = await order();
    expect(await cancelPaymentLink(o.depositLinkId!, { freelancerId: 'fl-1' })).toEqual({ ok: false, reason: 'ORDER_LINK' });
    expect((await cancelOrder('fl-1', o.id)).ok).toBe(true);
    const d = await db.read();
    expect(d.paymentLinks!.find((l) => l.id === o.depositLinkId)!.status).toBe('CANCELLED');
    expect(await payOrderFromWallet('en-1', o.id)).toMatchObject({ ok: false, reason: 'WRONG_STATUS' });
    const paid = await order();
    await payOrderFromWallet('en-1', paid.id);
    expect(await cancelOrder('en-1', paid.id)).toMatchObject({ ok: false, reason: 'WRONG_STATUS' });
  });
});

describe('accepting a devis', () => {
  it('turns a devis sent in the thread into an order, once', async () => {
    await db.update((d) => {
      d.invoices = [{ id: 'dv-1', freelancerId: 'fl-1', kind: 'DEVIS', number: 'D-2026-001', status: 'ISSUED', totals: { ht: 80_000, tva: 0, ttc: 80_000, timbre: 0, net: 80_000 }, createdAt: T0, issuedAt: T0 } as never];
    });
    const first = await order();
    const conversationId = first.conversationId!;
    // Not shared in the thread yet.
    expect(await acceptDevis('en-1', conversationId, 'dv-1')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    await sendMessage({ userId: 'fl-1', conversationId, body: '', attachment: { kind: 'INVOICE', invoiceId: 'dv-1' } });
    const r = await acceptDevis('en-1', conversationId, 'dv-1');
    expect(r.ok && r.value).toMatchObject({ total: 80_000, depositAmount: 40_000, source: { type: 'QUOTE', invoiceId: 'dv-1' } });
    expect(await acceptDevis('en-1', conversationId, 'dv-1')).toMatchObject({ ok: false, reason: 'ALREADY_ORDERED' });
    expect(await acceptDevis('en-2', conversationId, 'dv-1')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
  });
});
