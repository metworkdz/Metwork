/**
 * Gifts (owner decision 2026-11-02): a course or a Pass month bought for
 * someone else. Once paid, the recipient gets a claim link by email or
 * WhatsApp; claiming it on their own account grants the course for life (or a
 * Pass month that never renews). Unclaimed after 30 days, the amount goes back
 * to the buyer's wallet. Claimed, it is final: no refund.
 *
 * Money: the buyer pays their own price (Premium included). The mentors are
 * credited when the gift is CLAIMED — their share of the FULL price, at once
 * withdrawable (there is no refund window left) — never before, since an
 * unclaimed gift is refunded.
 *
 * The claim token is random and only in the link; the store keeps its hash.
 * Sending the link again issues a new token, so an old link stops working.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, type AcademyGiftRecord, type AcademyOrderRecord } from '@/server/db/store';
import { canBuyAcademy, isAcademyPremium, mentorShareRate, quoteCourse, quotePass } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { creditRefundInDraft } from '@/server/wallet/service';
import { createNotification } from '@/server/notifications/create-notification';
import { deliverClientText } from '@/server/notifications/mock';
import { getAcademyPricing } from './settings';
import { grantPassInDraft } from './pass-core';
import { activeEnrollment, afterOrderSettled, enrollAndCreditInDraft, openCardCheckout, payOrderFromWalletInDraft, type Buyer } from './orders';
import { sendGiftEmail } from './emails';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const GIFT_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function giftContactKind(contact: string): 'EMAIL' | 'PHONE' | null {
  const c = contact.trim();
  if (EMAIL_RE.test(c)) return 'EMAIL';
  return c.replace(/\D/g, '').length >= 9 && /^[+\d\s().-]+$/.test(c) ? 'PHONE' : null;
}

export type StartGiftResult =
  | { ok: true; state: 'PAID'; orderId: string; giftId: string }
  | { ok: true; state: 'REDIRECT'; orderId: string; redirectUrl: string }
  | { ok: false; code: 'NOT_A_BUYER' | 'COURSE_NOT_FOUND' | 'BAD_CONTACT' | 'WALLET_FROZEN' | 'PROVIDER_FAILED' }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

export interface StartGiftInput {
  user: Buyer;
  kind: 'COURSE' | 'PASS';
  courseSlug?: string;
  recipientName: string;
  recipientContact: string;
  message: string | null;
  method: 'WALLET' | 'CARD';
  clientReference: string;
  appBaseUrl: string;
  locale: string;
}

export async function startGiftPurchase(input: StartGiftInput): Promise<StartGiftResult> {
  const { user } = input;
  if (!canBuyAcademy(user.role)) return { ok: false, code: 'NOT_A_BUYER' };
  if (!giftContactKind(input.recipientContact)) return { ok: false, code: 'BAD_CONTACT' };
  const [d0, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const replay = (d0.academyOrders ?? []).find((o) => o.userId === user.id && o.clientReference === input.clientReference);
  if (replay) {
    if (replay.status === 'PAID') return { ok: true, state: 'PAID', orderId: replay.id, giftId: replay.giftId ?? '' };
    if (replay.redirectUrl) return { ok: true, state: 'REDIRECT', orderId: replay.id, redirectUrl: replay.redirectUrl };
    return { ok: false, code: 'PROVIDER_FAILED' };
  }

  const premium = isAcademyPremium(user);
  let courseId: string | null = null;
  let quote;
  let mentorShares: { mentorId: string; rate: number }[] = [];
  let label: string;
  if (input.kind === 'COURSE') {
    const course = (d0.academyCourses ?? []).find((c) => c.slug === input.courseSlug && c.status === 'PUBLISHED');
    if (!course) return { ok: false, code: 'COURSE_NOT_FOUND' };
    courseId = course.id;
    quote = quoteCourse(course.priceDzd, pricing, premium);
    mentorShares = course.mentorIds.map((id) => ({ mentorId: id, rate: mentorShareRate(d0.mentors.find((m) => m.id === id), pricing) }));
    label = `Startup Academy — cadeau : ${resolveText(course.title, 'fr')}`;
  } else {
    quote = quotePass('MONTHLY', pricing, premium);
    label = 'Startup Academy — cadeau : 1 mois de Pass';
  }

  const now = new Date().toISOString();
  const gift: AcademyGiftRecord = {
    id: randomUUID(),
    buyerId: user.id,
    kind: input.kind,
    courseId,
    recipientName: input.recipientName.trim().slice(0, 80),
    recipientContact: input.recipientContact.trim().slice(0, 120),
    message: input.message?.trim() ? input.message.trim().slice(0, 500) : null,
    tokenHash: '',
    status: 'PENDING_PAYMENT',
    orderId: null,
    listPriceDzd: quote.listPriceDzd,
    amountDzd: quote.amountDzd,
    mentorShares,
    paidAt: null,
    expiresAt: null,
    claimedBy: null,
    claimedAt: null,
    createdAt: now,
  };
  const order: AcademyOrderRecord = {
    id: randomUUID(),
    kind: 'GIFT',
    giftId: gift.id,
    userId: user.id,
    courseId: courseId ?? '',
    clientReference: input.clientReference,
    listPriceDzd: quote.listPriceDzd,
    amountDzd: quote.amountDzd,
    discount: quote.discount,
    // Credited at claim from the gift record, not at payment.
    mentorShares: [],
    method: input.method,
    providerRef: null,
    redirectUrl: null,
    status: 'PENDING',
    enrollmentId: null,
    createdAt: now,
    paidAt: null,
  };
  gift.orderId = order.id;
  await db.update((d) => {
    if (!Array.isArray(d.academyGifts)) d.academyGifts = [];
    d.academyGifts.push(gift);
  });

  if (input.method === 'WALLET') {
    const result = await db.update((d) => payOrderFromWalletInDraft(d, order, label));
    if (!result.ok) {
      await db.update((d) => { const g = d.academyGifts?.find((x) => x.id === gift.id); if (g) g.status = 'FAILED'; });
      return result;
    }
    await afterOrderSettled(result.outcome);
    return { ok: true, state: 'PAID', orderId: order.id, giftId: gift.id };
  }
  const card = await openCardCheckout(order, user, input.appBaseUrl, input.locale, label);
  if (!card.ok) return card;
  return card.state === 'PAID'
    ? { ok: true, state: 'PAID', orderId: order.id, giftId: gift.id }
    : { ok: true, state: 'REDIRECT', orderId: order.id, redirectUrl: card.redirectUrl };
}

function giftUrl(token: string, locale: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/+$/, '');
  return `${base}/${locale}/academy/gift/${token}`;
}

/**
 * Send (or send again) the claim link of a paid, unclaimed gift. Issues a new
 * token each time and returns it (server-side only: it never goes back to the
 * buyer's browser); null when there is nothing to send.
 */
export async function sendGiftLink(giftId: string): Promise<string | null> {
  const token = randomBytes(24).toString('base64url');
  const claimed = await db.update((d) => {
    const g = d.academyGifts?.find((x) => x.id === giftId);
    if (!g || g.status !== 'PAID') return null;
    g.tokenHash = sha256(token);
    const buyer = d.users.find((u) => u.id === g.buyerId);
    const course = g.courseId ? d.academyCourses?.find((c) => c.id === g.courseId) : null;
    return { gift: { ...g }, buyer, course };
  });
  if (!claimed) return null;
  const { gift, buyer, course } = claimed;
  const lang = buyer?.locale ?? 'fr';
  const what = course ? resolveText(course.title, lang) : 'Academy Pass';
  const fromName = buyer?.fullName ?? 'Metwork';
  const url = giftUrl(token, lang);
  if (giftContactKind(gift.recipientContact) === 'EMAIL') {
    await sendGiftEmail({ to: gift.recipientContact, lang, recipientName: gift.recipientName, fromName, what, message: gift.message, url, expiresAt: gift.expiresAt });
  } else {
    const text = {
      fr: `🎁 ${fromName} vous offre « ${what} » sur Metwork Startup Academy. Récupérez-le ici : ${url}`,
      en: `🎁 ${fromName} gave you “${what}” on Metwork Startup Academy. Claim it here: ${url}`,
      ar: `🎁 ${fromName} أهداك «${what}» على Metwork Startup Academy. استلمه من هنا: ${url}`,
    }[lang === 'en' || lang === 'ar' ? lang : 'fr'];
    await deliverClientText(gift.recipientContact, text, 'academy-gift');
  }
  if (buyer) {
    await createNotification({
      userId: buyer.id,
      type: 'ACADEMY_LEARNING',
      title: 'Cadeau envoyé',
      body: `${gift.recipientName} a reçu le lien pour « ${what} ».`,
      href: '/academy/my',
    });
  }
  return token;
}

export interface GiftClaimView {
  status: 'CLAIMABLE' | 'CLAIMED' | 'EXPIRED' | 'NOT_FOUND';
  kind?: 'COURSE' | 'PASS';
  what?: string;
  courseSlug?: string | null;
  fromName?: string;
  recipientName?: string;
  message?: string | null;
  expiresAt?: string | null;
}

function findByToken<T extends { tokenHash: string }>(gifts: T[] | undefined, token: string): T | null {
  if (!GIFT_TOKEN_RE.test(token)) return null;
  const h = sha256(token);
  return (gifts ?? []).find((g) => g.tokenHash && g.tokenHash === h) ?? null;
}

export async function giftForClaim(token: string, locale: string, now = new Date()): Promise<GiftClaimView> {
  const d = await db.read();
  const g = findByToken(d.academyGifts, token);
  if (!g) return { status: 'NOT_FOUND' };
  const course = g.courseId ? d.academyCourses?.find((c) => c.id === g.courseId) : null;
  const base = {
    kind: g.kind,
    what: course ? resolveText(course.title, locale) : 'Academy Pass',
    courseSlug: course?.slug ?? null,
    fromName: d.users.find((u) => u.id === g.buyerId)?.fullName ?? '',
    recipientName: g.recipientName,
    message: g.message,
    expiresAt: g.expiresAt,
  };
  if (g.status === 'CLAIMED') return { status: 'CLAIMED', ...base };
  if (g.status !== 'PAID' || (g.expiresAt && g.expiresAt <= now.toISOString())) return { status: 'EXPIRED', ...base };
  return { status: 'CLAIMABLE', ...base };
}

export type ClaimGiftResult =
  | { ok: true; kind: 'COURSE' | 'PASS'; courseSlug: string | null }
  | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_CLAIMED' | 'ALREADY_OWNED' };

/** Claim a gift on the signed-in account. Credits the mentors (course gifts) in the same write. */
export async function claimGift(token: string, userId: string, now = new Date()): Promise<ClaimGiftResult> {
  const res = await db.update((d) => {
    const g = findByToken(d.academyGifts, token);
    if (!g) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (g.status === 'CLAIMED') return { ok: false as const, code: 'ALREADY_CLAIMED' as const };
    if (g.status !== 'PAID' || (g.expiresAt && g.expiresAt <= now.toISOString())) return { ok: false as const, code: 'EXPIRED' as const };
    const nowIso = now.toISOString();
    const course = g.courseId ? d.academyCourses?.find((c) => c.id === g.courseId) : null;
    if (g.kind === 'COURSE') {
      if (!course) return { ok: false as const, code: 'NOT_FOUND' as const };
      if (activeEnrollment(d.academyEnrollments, userId, course.id)) return { ok: false as const, code: 'ALREADY_OWNED' as const };
      enrollAndCreditInDraft(d, {
        userId, courseId: course.id, source: 'GIFT', listPriceDzd: g.listPriceDzd, amountDzd: g.amountDzd,
        discount: 'NONE', mentorShares: g.mentorShares, paymentRef: g.orderId ?? `gift-${g.id}`, bucket: 'AVAILABLE', now: nowIso,
      });
    } else {
      grantPassInDraft(d, {
        userId, plan: 'MONTHLY', listPriceDzd: g.listPriceDzd, amountDzd: g.amountDzd, discount: 'NONE',
        method: 'GIFT', paymentRef: `gift-${g.id}`, now, autoRenew: false,
      });
    }
    g.status = 'CLAIMED';
    g.claimedBy = userId;
    g.claimedAt = nowIso;
    g.tokenHash = '';
    return { ok: true as const, kind: g.kind, courseSlug: course?.slug ?? null, buyerId: g.buyerId, recipientName: g.recipientName };
  });
  if (!res.ok) return res;
  await createNotification({
    userId: res.buyerId,
    type: 'ACADEMY_LEARNING',
    title: 'Cadeau reçu',
    body: `${res.recipientName} a récupéré votre cadeau.`,
    href: '/academy/my',
  });
  return { ok: true, kind: res.kind, courseSlug: res.courseSlug };
}

/** Daily: paid gifts unclaimed for 30 days go back to the buyer's wallet. Idempotent (status + wallet reference). */
export async function refundExpiredGifts(now = new Date()): Promise<{ refunded: number }> {
  const done = await db.update((d) => {
    const out: { buyerId: string; amount: number; name: string }[] = [];
    for (const g of d.academyGifts ?? []) {
      if (g.status !== 'PAID' || !g.expiresAt || g.expiresAt > now.toISOString()) continue;
      creditRefundInDraft(d, {
        userId: g.buyerId,
        amount: g.amountDzd,
        description: 'Startup Academy — cadeau non récupéré, remboursé',
        reference: `academy-gift-expired-${g.id}`,
        metadata: { giftId: g.id },
      });
      g.status = 'REFUNDED';
      g.tokenHash = '';
      out.push({ buyerId: g.buyerId, amount: g.amountDzd, name: g.recipientName });
    }
    return out;
  });
  for (const r of done) {
    await createNotification({
      userId: r.buyerId,
      type: 'ACADEMY_REFUNDED',
      title: 'Cadeau remboursé',
      body: `${r.name} n’a pas récupéré votre cadeau en 30 jours : ${r.amount.toLocaleString('fr-DZ')} DA ont été remis sur votre wallet.`,
      href: '/academy/my',
    });
  }
  return { refunded: done.length };
}

export interface MyGift {
  id: string;
  kind: 'COURSE' | 'PASS';
  what: string;
  recipientName: string;
  recipientContact: string;
  status: AcademyGiftRecord['status'];
  amountDzd: number;
  expiresAt: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export async function listMyGifts(buyerId: string, locale: string): Promise<MyGift[]> {
  const d = await db.read();
  return (d.academyGifts ?? [])
    .filter((g) => g.buyerId === buyerId && g.status !== 'PENDING_PAYMENT' && g.status !== 'FAILED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((g) => {
      const course = g.courseId ? d.academyCourses?.find((c) => c.id === g.courseId) : null;
      return {
        id: g.id, kind: g.kind, what: course ? resolveText(course.title, locale) : 'Academy Pass',
        recipientName: g.recipientName, recipientContact: g.recipientContact, status: g.status,
        amountDzd: g.amountDzd, expiresAt: g.expiresAt, claimedAt: g.claimedAt, createdAt: g.createdAt,
      };
    });
}

/** The buyer re-sends the link (a new one; the old link stops working). */
export async function resendGiftLink(buyerId: string, giftId: string): Promise<boolean> {
  const g = (await db.read()).academyGifts?.find((x) => x.id === giftId && x.buyerId === buyerId);
  if (!g) return false;
  return (await sendGiftLink(giftId)) !== null;
}
