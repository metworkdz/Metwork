/**
 * Startup Academy Pass — buying, cancelling, monthly renewal and the monthly
 * split of each subscriber's month between the mentors they watched.
 *
 * Owner decisions:
 *  - 3 500 DA / month, yearly −20 %, both admin-editable; Founder / Freelancer
 *    Premium −20 % on top (`quotePass`).
 *  - Monthly terms renew from the wallet (cancel = stop renewing, access kept to
 *    the end of the paid month); yearly terms are never auto-charged. Not refundable.
 *  - Mentors' share (30 % default, per-mentor override) is computed on the FULL
 *    Pass price of the month; Metwork absorbs the Premium discount.
 *  - Split PER SUBSCRIBER by watch time: a mentor gets
 *      month list price × their share × (seconds on their courses ÷ the
 *      subscriber's total Pass seconds that month)
 *    so fake viewing can only move the faker's own subscription. A subscriber who
 *    watched nothing leaves the month with Metwork.
 *  - Each subscriber month (an annual Pass = 12 slices) is settled when it ends
 *    and credited AVAILABLE at once (the Pass is not refundable).
 */
import { randomUUID } from 'node:crypto';
import { db, type AcademyOrderRecord, type AcademyPassRecord } from '@/server/db/store';
import { algiersDay, canBuyAcademy, isAcademyPremium, mentorShareRate, quotePass, type PassPlan, type PassQuote } from '@/lib/academy';
import { applyMentorEarningToDraft } from '@/server/mentors/ledger';
import { debitWalletInDraft } from '@/server/wallet/service';
import { createNotification } from '@/server/notifications/create-notification';
import { getAcademyPricing } from './settings';
import { activePass, grantPassInDraft, latestPass } from './pass-core';
import { afterOrderSettled, openCardCheckout, payOrderFromWalletInDraft, type Buyer } from './orders';
import { academyRepo } from './repo';

/* ─────────────────────────── Status ─────────────────────────── */

export interface PassStatus {
  active: { plan: PassPlan; periodEnd: string; autoRenew: boolean; nextTermStartsAt: string | null } | null;
  premium: boolean;
  quotes: Record<PassPlan, PassQuote>;
}

export async function passStatusFor(user: Buyer | null): Promise<PassStatus> {
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const premium = isAcademyPremium(user);
  const quotes = { MONTHLY: quotePass('MONTHLY', pricing, premium), ANNUAL: quotePass('ANNUAL', pricing, premium) };
  if (!user) return { active: null, premium, quotes };
  const current = activePass(d, user.id);
  const latest = latestPass(d, user.id);
  return {
    premium,
    quotes,
    active: current
      ? {
          plan: current.plan,
          periodEnd: latest?.periodEnd ?? current.periodEnd,
          autoRenew: (latest ?? current).autoRenew,
          nextTermStartsAt: latest && latest.id !== current.id ? latest.periodStart : null,
        }
      : null,
  };
}

/* ─────────────────────────── Buying ─────────────────────────── */

export type StartPassResult =
  | { ok: true; state: 'PAID'; orderId: string }
  | { ok: true; state: 'REDIRECT'; orderId: string; redirectUrl: string }
  | { ok: false; code: 'NOT_A_BUYER' | 'ALREADY_SUBSCRIBED' | 'WALLET_FROZEN' | 'PROVIDER_FAILED' }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

export interface StartPassInput {
  user: Buyer;
  plan: PassPlan;
  method: 'WALLET' | 'CARD';
  clientReference: string;
  appBaseUrl: string;
  locale: string;
}

/**
 * Buy a Pass term. Refused while a monthly Pass is renewing on its own (nothing
 * to buy); allowed to extend a cancelled or yearly Pass, which then starts at
 * the end of the current term.
 */
export async function startPassPurchase(input: StartPassInput): Promise<StartPassResult> {
  const { user } = input;
  if (!canBuyAcademy(user.role)) return { ok: false, code: 'NOT_A_BUYER' };

  const d0 = await db.read();
  const replay = (d0.academyOrders ?? []).find((o) => o.userId === user.id && o.clientReference === input.clientReference);
  if (replay) {
    if (replay.status === 'PAID') return { ok: true, state: 'PAID', orderId: replay.id };
    if (replay.redirectUrl) return { ok: true, state: 'REDIRECT', orderId: replay.id, redirectUrl: replay.redirectUrl };
    return { ok: false, code: 'PROVIDER_FAILED' };
  }
  const latest = latestPass(d0, user.id);
  if (latest && latest.autoRenew && latest.periodEnd > new Date().toISOString()) return { ok: false, code: 'ALREADY_SUBSCRIBED' };

  const pricing = await getAcademyPricing();
  const quote = quotePass(input.plan, pricing, isAcademyPremium(user));
  const order: AcademyOrderRecord = {
    id: randomUUID(),
    kind: 'PASS',
    passPlan: input.plan,
    userId: user.id,
    courseId: '',
    clientReference: input.clientReference,
    listPriceDzd: quote.listPriceDzd,
    amountDzd: quote.amountDzd,
    discount: quote.discount,
    // Pass shares are frozen per month at settlement, from watch time.
    mentorShares: [],
    method: input.method,
    providerRef: null,
    redirectUrl: null,
    status: 'PENDING',
    enrollmentId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  };
  const label = input.plan === 'ANNUAL' ? 'Startup Academy Pass — annuel' : 'Startup Academy Pass — mensuel';

  if (input.method === 'WALLET') {
    const result = await db.update((d) => payOrderFromWalletInDraft(d, order, label));
    if (!result.ok) return result;
    await afterOrderSettled(result.outcome);
    return { ok: true, state: 'PAID', orderId: order.id };
  }
  const card = await openCardCheckout(order, user, input.appBaseUrl, input.locale, label);
  if (!card.ok) return card;
  return card.state === 'PAID'
    ? { ok: true, state: 'PAID', orderId: order.id }
    : { ok: true, state: 'REDIRECT', orderId: order.id, redirectUrl: card.redirectUrl };
}

/** Stop (false) or resume (true) monthly renewal. Access runs to the end of the paid month either way. */
export async function setPassAutoRenew(userId: string, autoRenew: boolean): Promise<{ ok: true } | { ok: false; code: 'NO_PASS' | 'NOT_MONTHLY' }> {
  return db.update((d) => {
    const latest = latestPass(d, userId);
    if (!latest || latest.periodEnd <= new Date().toISOString()) return { ok: false as const, code: 'NO_PASS' as const };
    if (latest.plan !== 'MONTHLY') return { ok: false as const, code: 'NOT_MONTHLY' as const };
    latest.autoRenew = autoRenew;
    return { ok: true as const };
  });
}

/* ─────────────────────────── Renewal (cron) ─────────────────────────── */

export const PASS_REMINDER_DAYS = 3;
const DAY = 86_400_000;

export interface PassRenewalResult { renewed: number; lapsed: number; reminded: number; expired: number }

/**
 * Daily. Monthly terms with renewal on: a reminder 3 days before the end, then a
 * new month from the wallet at the LIVE price (Premium decided at renewal). Not
 * enough in the wallet ⇒ the Pass ends. Every ended term is marked EXPIRED.
 * Idempotent: a renewed term's `paymentRef` is unique per term, and the old one
 * stops renewing inside the same write.
 */
export async function runPassRenewals(now = new Date()): Promise<PassRenewalResult> {
  const pricing = await getAcademyPricing();
  const nowIso = now.toISOString();
  const notices: { userId: string; kind: 'REMINDER' | 'RENEWED' | 'LAPSED'; amount: number; periodEnd: string }[] = [];

  const result = await db.update((d) => {
    const r: PassRenewalResult = { renewed: 0, lapsed: 0, reminded: 0, expired: 0 };
    const terms = [...(d.academyPasses ?? [])].filter((p) => p.status === 'ACTIVE');
    for (const term of terms) {
      const user = d.users.find((u) => u.id === term.userId);
      const ended = term.periodEnd <= nowIso;
      const quote = quotePass('MONTHLY', pricing, isAcademyPremium(user ?? null, now));

      if (!ended) {
        if (term.autoRenew && !term.renewalReminderSentAt && new Date(term.periodEnd).getTime() - now.getTime() <= PASS_REMINDER_DAYS * DAY) {
          term.renewalReminderSentAt = nowIso;
          notices.push({ userId: term.userId, kind: 'REMINDER', amount: quote.amountDzd, periodEnd: term.periodEnd });
          r.reminded++;
        }
        continue;
      }

      term.status = 'EXPIRED';
      r.expired++;
      if (!term.autoRenew || !user || !canBuyAcademy(user.role)) continue;
      term.autoRenew = false;
      const ref = `academy-pass-renewal-${term.id}`;
      const debit = debitWalletInDraft(d, {
        userId: term.userId,
        amount: quote.amountDzd,
        description: 'Startup Academy Pass — renouvellement mensuel',
        reference: ref,
        metadata: { previousTermId: term.id, listPriceDzd: quote.listPriceDzd, discount: quote.discount },
      });
      if (!debit.ok) {
        notices.push({ userId: term.userId, kind: 'LAPSED', amount: quote.amountDzd, periodEnd: term.periodEnd });
        r.lapsed++;
        continue;
      }
      const next = grantPassInDraft(d, {
        userId: term.userId, plan: 'MONTHLY', listPriceDzd: quote.listPriceDzd, amountDzd: quote.amountDzd,
        discount: quote.discount, method: 'RENEWAL', paymentRef: ref, now: new Date(term.periodEnd),
      });
      // A renewal continues the old term without a gap, even when the cron runs late.
      notices.push({ userId: term.userId, kind: 'RENEWED', amount: quote.amountDzd, periodEnd: next.periodEnd });
      r.renewed++;
    }
    return r;
  });

  for (const n of notices) {
    const date = new Date(n.periodEnd).toLocaleDateString('fr-DZ', { day: 'numeric', month: 'long' });
    const amount = `${n.amount.toLocaleString('fr-DZ')} DA`;
    await createNotification({
      userId: n.userId,
      type: 'ACADEMY_PASS',
      title: n.kind === 'REMINDER' ? 'Votre Pass se renouvelle bientôt' : n.kind === 'RENEWED' ? 'Academy Pass renouvelé' : 'Academy Pass terminé',
      body: n.kind === 'REMINDER'
        ? `Le ${date}, ${amount} seront prélevés sur votre wallet. Gérez votre Pass depuis « Mon apprentissage ».`
        : n.kind === 'RENEWED'
          ? `${amount} prélevés sur votre wallet. Votre Pass court jusqu’au ${date}.`
          : `Solde insuffisant pour renouveler (${amount}). Rechargez votre wallet puis reprenez le Pass.`,
      href: n.kind === 'LAPSED' ? '/academy/pass' : '/academy/my',
    });
  }
  return result;
}

/* ─────────────────────────── Settlement (cron) ─────────────────────────── */

export interface PassSettlementLine { mentorId: string; seconds: number; rate: number; amountDzd: number }

/**
 * The mentors' lines for one subscriber month. Pure: `watched` is that
 * subscriber's Pass seconds per mentor during the month.
 */
export function splitSlice(
  baseDzd: number,
  watched: { mentorId: string; seconds: number }[],
  rateOf: (mentorId: string) => number,
): PassSettlementLine[] {
  const total = watched.reduce((s, w) => s + w.seconds, 0);
  if (total <= 0 || baseDzd <= 0) return [];
  return watched
    .filter((w) => w.seconds > 0)
    .map((w) => {
      const rate = rateOf(w.mentorId);
      return { mentorId: w.mentorId, seconds: w.seconds, rate, amountDzd: Math.round(baseDzd * rate * (w.seconds / total)) };
    });
}

/**
 * Daily. Every subscriber month that has ended and is not settled yet is split
 * between the mentors that subscriber watched, and credited to their wallets.
 * Idempotent: `settledAt` is claimed inside the write, and each credit has its
 * own ledger reference.
 */
export async function settlePassMonths(now = new Date()): Promise<{ settled: number; credited: number }> {
  const nowIso = now.toISOString();
  const d0 = await db.read();
  const due: { termId: string; index: number; userId: string; from: string; to: string }[] = [];
  for (const term of d0.academyPasses ?? []) {
    term.slices.forEach((s, index) => {
      if (!s.settledAt && s.end <= nowIso) {
        // The ledger counts by Algiers day; the month's last day is the day before `end`.
        due.push({ termId: term.id, index, userId: term.userId, from: algiersDay(s.start), to: algiersDay(new Date(new Date(s.end).getTime() - 1)) });
      }
    });
  }
  if (!due.length) return { settled: 0, credited: 0 };

  // Watch time is read before the write (it lives in Postgres); one query per distinct window.
  const repo = academyRepo();
  const cache = new Map<string, Awaited<ReturnType<typeof repo.watchTotals>>>();
  const watchedBy = async (from: string, to: string, userId: string) => {
    const key = `${from}|${to}`;
    if (!cache.has(key)) cache.set(key, await repo.watchTotals(from, to, 'PASS'));
    return cache.get(key)!.filter((t) => t.userId === userId).map((t) => ({ mentorId: t.mentorId, seconds: t.seconds }));
  };
  const watched = await Promise.all(due.map((x) => watchedBy(x.from, x.to, x.userId)));
  const pricing = await getAcademyPricing();

  return db.update((d) => {
    let settled = 0;
    let credited = 0;
    due.forEach((x, i) => {
      const term = d.academyPasses?.find((p) => p.id === x.termId);
      const slice = term?.slices[x.index];
      if (!term || !slice || slice.settledAt) return;
      const lines = splitSlice(slice.baseDzd, watched[i]!, (mentorId) => mentorShareRate(d.mentors.find((m) => m.id === mentorId), pricing));
      for (const line of lines) {
        if (line.amountDzd <= 0 || !d.mentors.some((m) => m.id === line.mentorId)) continue;
        const fraction = line.seconds / watched[i]!.reduce((s, w) => s + w.seconds, 0);
        applyMentorEarningToDraft(d, {
          mentorId: line.mentorId,
          bookingId: `academy-pass-${term.id}-${x.index}`,
          grossAmount: Math.round(slice.paidDzd * fraction),
          consultantShareBase: Math.round(slice.baseDzd * fraction),
          tierDiscountAmount: Math.round((slice.baseDzd - slice.paidDzd) * fraction),
          kind: 'ACADEMY_PASS',
          bucket: 'AVAILABLE',
          frozenPlatformRate: 1 - line.rate,
        });
        credited++;
      }
      slice.lines = lines;
      slice.settledAt = nowIso;
      settled++;
    });
    return { settled, credited };
  });
}

/** Terms of one user, newest first (for "My learning" and admin). */
export async function passHistory(userId: string): Promise<AcademyPassRecord[]> {
  return [...((await db.read()).academyPasses ?? [])].filter((p) => p.userId === userId).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
}
