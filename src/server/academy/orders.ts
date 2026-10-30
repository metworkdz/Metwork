/**
 * Buying a Startup Academy course — wallet or card (CIB / Edahabia through the
 * hosted SlickPay checkout) — plus refunds and the end-of-refund-window release
 * of the mentors' earnings.
 *
 * Guarantees, mirroring the consultation direct-payment flow:
 *  - The price is computed here (`quoteCourse`), never sent by the browser, and
 *    frozen on the order with each mentor's share.
 *  - A card payment is confirmed only by asking the provider, or by a
 *    signature-verified webhook — never by the browser coming back.
 *  - Settlement is idempotent: the PAID transition is claimed inside ONE store
 *    update that also creates the enrollment and credits the mentors, so a
 *    replay (refresh, webhook + return page) moves money exactly once.
 *  - A wallet purchase debits, enrolls and credits in that same single update.
 *
 * Money (owner decisions 2026-10-26): each mentor earns their Academy share of
 * the FULL course price (Metwork absorbs the Premium discount), held PENDING for
 * the 7-day refund window, then released. A refund returns what the buyer paid
 * to their Metwork wallet and voids the held earnings in the same write.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type AcademyCourseRecord,
  type AcademyEnrollmentRecord,
  type AcademyOrderRecord,
  type UserRecord,
} from '@/server/db/store';
import {
  ACADEMY_REFUND_MAX_WATCHED,
  canBuyAcademy,
  isAcademyPremium,
  mentorShareRate,
  quoteCourse,
  refundWindowEndsAt,
  type CourseQuote,
} from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { creditRefundInDraft, debitWalletInDraft } from '@/server/wallet/service';
import {
  applyMentorEarningToDraft,
  releaseEarningInDraft,
  voidPendingEarningInDraft,
} from '@/server/mentors/ledger';
import { getActiveProvider } from '@/server/payments/registry';
import { getSlickPayTransferStatus } from '@/server/payments/slickpay-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import { createNotification } from '@/server/notifications/create-notification';
import { getAcademyPricing } from './settings';
import { academyRepo } from './repo';

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];
type Buyer = Pick<UserRecord, 'id' | 'role' | 'fullName' | 'email' | 'phone' | 'membershipCode' | 'membershipTier' | 'membershipExpiresAt'>;

/** The enrollment that gives this user the course for life, if any. */
export function activeEnrollment(
  enrollments: AcademyEnrollmentRecord[] | undefined,
  userId: string,
  courseId: string,
): AcademyEnrollmentRecord | null {
  return (enrollments ?? []).find((e) => e.userId === userId && e.courseId === courseId && !e.refundedAt && !e.revokedAt) ?? null;
}

/** Ledger key of one mentor's earning on one enrollment. */
const earningKey = (enrollmentId: string) => `academy-${enrollmentId}`;

/* ─────────────────────────── Quote ─────────────────────────── */

export type QuoteResult =
  | { ok: true; course: AcademyCourseRecord; quote: CourseQuote; premium: boolean; owned: boolean }
  | { ok: false; code: 'COURSE_NOT_FOUND' };

export async function quoteForBuyer(user: Buyer | null, courseSlug: string): Promise<QuoteResult> {
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const course = (d.academyCourses ?? []).find((c) => c.slug === courseSlug && c.status === 'PUBLISHED');
  if (!course) return { ok: false, code: 'COURSE_NOT_FOUND' };
  const premium = isAcademyPremium(user);
  return {
    ok: true,
    course,
    quote: quoteCourse(course.priceDzd, pricing, premium),
    premium,
    owned: user ? Boolean(activeEnrollment(d.academyEnrollments, user.id, course.id)) : false,
  };
}

/* ─────────────────────────── Settlement (one place) ─────────────────────────── */

interface SettleOutcome {
  claimed: boolean;
  order: AcademyOrderRecord;
  enrollment: AcademyEnrollmentRecord | null;
  duplicate: boolean;
}

/**
 * Mark an order PAID and grant the course, inside an open update. Idempotent:
 * an order already PAID returns `claimed: false` and changes nothing. If the
 * buyer already owns the course (two payments raced), the second payment goes
 * back to their wallet instead of creating a second enrollment.
 */
function settleOrderInDraft(d: StoreDraft, order: AcademyOrderRecord, providerRef: string | null): SettleOutcome {
  if (order.status === 'PAID') {
    const enrollment = (d.academyEnrollments ?? []).find((e) => e.id === order.enrollmentId) ?? null;
    return { claimed: false, order, enrollment, duplicate: Boolean(order.duplicateRefunded) };
  }
  const now = new Date().toISOString();
  order.status = 'PAID';
  order.paidAt = now;
  if (providerRef) order.providerRef = providerRef;

  if (!Array.isArray(d.academyEnrollments)) d.academyEnrollments = [];
  if (activeEnrollment(d.academyEnrollments, order.userId, order.courseId)) {
    order.duplicateRefunded = true;
    creditRefundInDraft(d, {
      userId: order.userId,
      amount: order.amountDzd,
      description: 'Startup Academy — duplicate purchase returned',
      reference: `academy-duplicate-${order.id}`,
      metadata: { orderId: order.id, courseId: order.courseId },
    });
    return { claimed: true, order, enrollment: null, duplicate: true };
  }

  const enrollment: AcademyEnrollmentRecord = {
    id: randomUUID(),
    userId: order.userId,
    courseId: order.courseId,
    source: 'PURCHASE',
    listPriceDzd: order.listPriceDzd,
    pricePaidDzd: order.amountDzd,
    discount: order.discount,
    mentorShareRate: order.mentorShares[0]?.rate ?? 0,
    paymentRef: order.id,
    createdAt: now,
    refundedAt: null,
    revokedAt: null,
    earningsReleasedAt: null,
  };
  d.academyEnrollments.push(enrollment);
  order.enrollmentId = enrollment.id;

  // Each mentor: their share of the FULL price, split evenly between co-mentors.
  const n = order.mentorShares.length || 1;
  for (const share of order.mentorShares) {
    applyMentorEarningToDraft(d, {
      mentorId: share.mentorId,
      bookingId: earningKey(enrollment.id),
      grossAmount: Math.round(order.amountDzd / n),
      consultantShareBase: Math.round(order.listPriceDzd / n),
      tierDiscountAmount: Math.round((order.listPriceDzd - order.amountDzd) / n),
      kind: 'ACADEMY_COURSE',
      bucket: 'PENDING',
      frozenPlatformRate: 1 - share.rate,
    });
  }
  return { claimed: true, order, enrollment, duplicate: false };
}

async function afterClaim(outcome: SettleOutcome): Promise<void> {
  if (!outcome.claimed) return;
  const course = (await db.read()).academyCourses?.find((c) => c.id === outcome.order.courseId);
  const title = course ? resolveText(course.title, 'fr') : '';
  await createNotification({
    userId: outcome.order.userId,
    type: outcome.duplicate ? 'ACADEMY_REFUNDED' : 'ACADEMY_ENROLLED',
    title: outcome.duplicate ? 'Achat en double remboursé' : 'Cours débloqué',
    body: outcome.duplicate
      ? `Vous aviez déjà « ${title} ». Le montant a été remis sur votre wallet.`
      : `« ${title} » est à vous, pour toujours. Bon apprentissage !`,
    href: course ? `/academy/learn/${course.slug}` : '/academy/my',
  });
}

/* ─────────────────────────── Buying ─────────────────────────── */

export type StartPurchaseResult =
  | { ok: true; state: 'PAID'; orderId: string; courseSlug: string }
  | { ok: true; state: 'REDIRECT'; orderId: string; redirectUrl: string }
  | { ok: false; code: 'NOT_A_BUYER' | 'COURSE_NOT_FOUND' | 'ALREADY_OWNED' | 'WALLET_FROZEN' | 'PROVIDER_FAILED' }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

export interface StartPurchaseInput {
  user: Buyer;
  courseSlug: string;
  method: 'WALLET' | 'CARD';
  clientReference: string;
  appBaseUrl: string;
  locale: string;
}

export async function startCoursePurchase(input: StartPurchaseInput): Promise<StartPurchaseResult> {
  const { user } = input;
  if (!canBuyAcademy(user.role)) return { ok: false, code: 'NOT_A_BUYER' };

  // Replay of the same click: answer with what happened the first time.
  const d0 = await db.read();
  const replay = (d0.academyOrders ?? []).find((o) => o.userId === user.id && o.clientReference === input.clientReference);
  if (replay) {
    const course = d0.academyCourses?.find((c) => c.id === replay.courseId);
    if (replay.status === 'PAID') return { ok: true, state: 'PAID', orderId: replay.id, courseSlug: course?.slug ?? '' };
    if (replay.redirectUrl) return { ok: true, state: 'REDIRECT', orderId: replay.id, redirectUrl: replay.redirectUrl };
    return { ok: false, code: 'PROVIDER_FAILED' };
  }

  const q = await quoteForBuyer(user, input.courseSlug);
  if (!q.ok) return q;
  if (q.owned) return { ok: false, code: 'ALREADY_OWNED' };
  const { course, quote } = q;

  const pricing = await getAcademyPricing();
  const mentors = d0.mentors;
  const order: AcademyOrderRecord = {
    id: randomUUID(),
    userId: user.id,
    courseId: course.id,
    clientReference: input.clientReference,
    listPriceDzd: quote.listPriceDzd,
    amountDzd: quote.amountDzd,
    discount: quote.discount,
    mentorShares: course.mentorIds.map((id) => ({ mentorId: id, rate: mentorShareRate(mentors.find((m) => m.id === id), pricing) })),
    method: input.method,
    providerRef: null,
    redirectUrl: null,
    status: 'PENDING',
    enrollmentId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  };

  if (input.method === 'WALLET') {
    const result = await db.update((d) => {
      if (activeEnrollment(d.academyEnrollments, user.id, course.id)) return { ok: false as const, code: 'ALREADY_OWNED' as const };
      const debit = debitWalletInDraft(d, {
        userId: user.id,
        amount: order.amountDzd,
        description: `Startup Academy — ${resolveText(course.title, 'fr')}`,
        reference: `academy-order-${order.id}`,
        metadata: { orderId: order.id, courseId: course.id, listPriceDzd: order.listPriceDzd, discount: order.discount },
      });
      if (!debit.ok) return debit.reason === 'INSUFFICIENT_FUNDS'
        ? { ok: false as const, code: 'INSUFFICIENT_FUNDS' as const, balance: debit.balance, required: debit.required }
        : { ok: false as const, code: 'WALLET_FROZEN' as const };
      if (!Array.isArray(d.academyOrders)) d.academyOrders = [];
      d.academyOrders.push(order);
      return { ok: true as const, outcome: settleOrderInDraft(d, order, null) };
    });
    if (!result.ok) return result;
    await afterClaim(result.outcome);
    return { ok: true, state: 'PAID', orderId: order.id, courseSlug: course.slug };
  }

  // Card: record the order, then open the hosted checkout with the order id as external id.
  await db.update((d) => {
    if (!Array.isArray(d.academyOrders)) d.academyOrders = [];
    d.academyOrders.push(order);
  });
  const base = input.appBaseUrl.replace(/\/$/, '');
  const returnUrl = `${base}/${input.locale}/academy/checkout/return/${order.id}`;
  const provider = getActiveProvider();
  let res;
  try {
    res = await provider.initTopUp({
      topUpId: order.id,
      userId: user.id,
      amount: order.amountDzd,
      returnUrl,
      webhookUrl: `${base}/api/webhooks/payments/${provider.code}`,
      customer: { fullName: user.fullName, email: user.email, phone: user.phone ?? '' },
      description: `Startup Academy — ${resolveText(course.title, input.locale)}`.slice(0, 120),
      locale: input.locale,
    });
  } catch (err) {
    console.error('[academy] checkout init failed', String(err));
    await db.update((d) => { const o = d.academyOrders?.find((x) => x.id === order.id); if (o) o.status = 'FAILED'; });
    return { ok: false, code: 'PROVIDER_FAILED' };
  }
  await db.update((d) => {
    const o = d.academyOrders?.find((x) => x.id === order.id);
    if (o) { o.providerRef = res.providerRef; o.redirectUrl = res.redirectUrl; }
  });
  if (res.status === 'COMPLETED') {
    await settleAcademyOrder(order.id, res.providerRef);
    return { ok: true, state: 'PAID', orderId: order.id, courseSlug: course.slug };
  }
  if (res.status === 'FAILED' || !res.redirectUrl) return { ok: false, code: 'PROVIDER_FAILED' };
  return { ok: true, state: 'REDIRECT', orderId: order.id, redirectUrl: res.redirectUrl };
}

/** Settle a card order whose payment is confirmed. Idempotent. */
export async function settleAcademyOrder(orderId: string, providerRef: string | null): Promise<SettleOutcome | null> {
  const outcome = await db.update((d) => {
    const order = d.academyOrders?.find((o) => o.id === orderId);
    if (!order || order.method !== 'CARD') return null;
    return settleOrderInDraft(d, order, providerRef);
  });
  if (outcome) await afterClaim(outcome);
  return outcome;
}

/**
 * Settle from a SIGNATURE-VERIFIED provider webhook (the dispatcher passes the
 * external id we set: the order id). FAILED marks a pending order failed.
 */
export async function settleAcademyOrderFromWebhook(
  orderId: string,
  providerRef: string | null,
  status: 'COMPLETED' | 'FAILED',
): Promise<'SETTLED' | 'ALREADY' | 'NOT_FOUND' | 'IGNORED'> {
  const order = (await db.read()).academyOrders?.find((o) => o.id === orderId && o.method === 'CARD');
  if (!order) return 'NOT_FOUND';
  if (order.status === 'PAID') return 'ALREADY';
  if (status !== 'COMPLETED') {
    await db.update((d) => { const o = d.academyOrders?.find((x) => x.id === orderId); if (o && o.status === 'PENDING') o.status = 'FAILED'; });
    return 'IGNORED';
  }
  const outcome = await settleAcademyOrder(orderId, providerRef);
  return outcome?.claimed ? 'SETTLED' : 'ALREADY';
}

export type OrderView =
  | { state: 'NOT_FOUND' }
  | { state: 'PAID' | 'PENDING' | 'FAILED'; order: AcademyOrderRecord; courseSlug: string; duplicate: boolean };

/**
 * The buyer came back from the hosted checkout: ask the provider (never trust
 * the redirect) and settle if paid. Only the order's own buyer gets a view.
 */
export async function verifyAcademyOrder(orderId: string, userId: string): Promise<OrderView> {
  const d = await db.read();
  const order = d.academyOrders?.find((o) => o.id === orderId && o.userId === userId);
  if (!order) return { state: 'NOT_FOUND' };
  const slug = d.academyCourses?.find((c) => c.id === order.courseId)?.slug ?? '';
  if (order.status !== 'PENDING' || !order.providerRef) {
    return { state: order.status, order, courseSlug: slug, duplicate: Boolean(order.duplicateRefunded) };
  }
  try {
    const status = await getSlickPayTransferStatus(order.providerRef);
    if (status.completed === 1) {
      const outcome = await settleAcademyOrder(order.id, order.providerRef);
      if (outcome) return { state: 'PAID', order: outcome.order, courseSlug: slug, duplicate: outcome.duplicate };
    }
  } catch (err) {
    if (!(err instanceof ProviderNotConfiguredError)) console.error('[academy] order status check failed', String(err));
  }
  return { state: 'PENDING', order, courseSlug: slug, duplicate: false };
}

/* ─────────────────────────── Refunds ─────────────────────────── */

export type RefundCheck =
  | { eligible: true; endsAt: string; amountDzd: number }
  | { eligible: false; reason: 'NOT_FOUND' | 'NOT_A_PURCHASE' | 'ALREADY_REFUNDED' | 'WINDOW_CLOSED' | 'WATCHED_TOO_MUCH' | 'FREE' };

function releasedSeconds(course: AcademyCourseRecord | undefined): number {
  return (course?.modules ?? []).filter((m) => !m.comingSoon).flatMap((m) => m.lessons).reduce((s, l) => s + l.durationSec, 0);
}

/** Owner rule: within 7 days, under 25 % of the released course watched, no certificate (none exist yet). */
export async function refundCheck(userId: string, enrollmentId: string, now = new Date()): Promise<RefundCheck> {
  const d = await db.read();
  const e = d.academyEnrollments?.find((x) => x.id === enrollmentId && x.userId === userId);
  if (!e) return { eligible: false, reason: 'NOT_FOUND' };
  if (e.source !== 'PURCHASE') return { eligible: false, reason: 'NOT_A_PURCHASE' };
  if (e.refundedAt || e.revokedAt) return { eligible: false, reason: 'ALREADY_REFUNDED' };
  if (e.pricePaidDzd <= 0) return { eligible: false, reason: 'FREE' };
  const endsAt = refundWindowEndsAt(e.createdAt);
  if (now >= endsAt || e.earningsReleasedAt) return { eligible: false, reason: 'WINDOW_CLOSED' };
  const total = releasedSeconds(d.academyCourses?.find((c) => c.id === e.courseId));
  const watched = await academyRepo().courseWatchSeconds(userId, e.courseId);
  if (total > 0 && watched >= total * ACADEMY_REFUND_MAX_WATCHED) return { eligible: false, reason: 'WATCHED_TOO_MUCH' };
  return { eligible: true, endsAt: endsAt.toISOString(), amountDzd: e.pricePaidDzd };
}

export type RefundResult = { ok: true; amountDzd: number } | { ok: false; reason: Exclude<RefundCheck, { eligible: true }>['reason'] };

/** Refund to the Metwork wallet and void the mentors' held earnings — one write. */
export async function refundEnrollment(userId: string, enrollmentId: string): Promise<RefundResult> {
  const check = await refundCheck(userId, enrollmentId);
  if (!check.eligible) return { ok: false, reason: check.reason };
  const done = await db.update((d) => {
    const e = d.academyEnrollments?.find((x) => x.id === enrollmentId && x.userId === userId);
    // Re-checked inside the write: a concurrent refund or release wins.
    if (!e || e.refundedAt || e.revokedAt || e.earningsReleasedAt) return false;
    const order = d.academyOrders?.find((o) => o.id === e.paymentRef);
    e.refundedAt = new Date().toISOString();
    creditRefundInDraft(d, {
      userId,
      amount: e.pricePaidDzd,
      description: 'Startup Academy — course refunded',
      reference: `academy-refund-${e.id}`,
      metadata: { enrollmentId: e.id, courseId: e.courseId },
    });
    for (const share of order?.mentorShares ?? []) {
      voidPendingEarningInDraft(d, { mentorId: share.mentorId, bookingId: earningKey(e.id), description: 'Academy course refunded within 7 days' });
    }
    return true;
  });
  if (!done) return { ok: false, reason: 'ALREADY_REFUNDED' };
  await createNotification({
    userId,
    type: 'ACADEMY_REFUNDED',
    title: 'Cours remboursé',
    body: `${check.amountDzd.toLocaleString('fr-DZ')} DA ont été remis sur votre wallet Metwork.`,
    href: '/dashboard',
  });
  return { ok: true, amountDzd: check.amountDzd };
}

/* ─────────────────────────── Release (cron) ─────────────────────────── */

/**
 * Daily: purchases past the refund window move their mentors' earnings from
 * held to withdrawable. Idempotent per enrollment (`earningsReleasedAt`, and the
 * ledger's own release reference).
 */
export async function releaseAcademyEarnings(now = new Date()): Promise<{ released: number }> {
  const released = await db.update((d) => {
    let n = 0;
    for (const e of d.academyEnrollments ?? []) {
      if (e.source !== 'PURCHASE' || e.refundedAt || e.revokedAt || e.earningsReleasedAt) continue;
      if (refundWindowEndsAt(e.createdAt) > now) continue;
      const order = d.academyOrders?.find((o) => o.id === e.paymentRef);
      for (const share of order?.mentorShares ?? []) {
        releaseEarningInDraft(d, { mentorId: share.mentorId, bookingId: earningKey(e.id), description: 'Academy course sale released after the refund window' });
      }
      e.earningsReleasedAt = now.toISOString();
      n++;
    }
    return n;
  });
  return { released };
}
