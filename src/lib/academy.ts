/**
 * Startup Academy — the numbers and rules every Academy surface shares.
 *
 * Client-safe on purpose: the Pass page, the checkout, the course builder and
 * the server all price from these functions, so a price shown is the price
 * charged. Owner decisions of 2026-10-26 (see docs/startup-academy-blueprint.html):
 *   - Pass 3 500 DA / month, yearly = −20 %, price editable by the admin;
 *   - course price set by its author, never below 2 900 DA;
 *   - Founder and Freelancer Premium members −20 % on courses and the Pass;
 *   - mentors earn 30 % by default (Metwork 70 %), overridable per mentor.
 *
 * Rates are fractions (0.3 = 30 %), like `commissionRate` elsewhere in the app.
 * Amounts are whole dinars.
 */

import { normalizePlanCode } from '@/lib/membership-benefits';

export const ACADEMY_MIN_COURSE_PRICE_DZD = 2900;
/** Upper bound on anything an admin or author types, to catch an extra zero. */
export const ACADEMY_MAX_PRICE_DZD = 500_000;

export const ACADEMY_DEFAULTS = {
  passMonthlyPriceDzd: 3500,
  passAnnualDiscountRate: 0.2,
  premiumDiscountRate: 0.2,
  defaultMentorShareRate: 0.3,
} as const;

/** What the admin can change, as stored (`academySettings` in the store). */
export interface AcademyPricing {
  passMonthlyPriceDzd: number;
  passAnnualDiscountRate: number;
  premiumDiscountRate: number;
  defaultMentorShareRate: number;
}

function dinars(n: number): number {
  return Math.round(n);
}

/** Price after a fractional discount, in whole dinars. */
export function discounted(priceDzd: number, rate: number): number {
  return dinars(priceDzd * (1 - rate));
}

/** Yearly Pass price: twelve months less the annual discount. */
export function passAnnualPriceDzd(p: AcademyPricing): number {
  return discounted(p.passMonthlyPriceDzd * 12, p.passAnnualDiscountRate);
}

/** Both Pass prices, before and after the Premium discount. */
export function passPrices(p: AcademyPricing) {
  const monthly = p.passMonthlyPriceDzd;
  const annual = passAnnualPriceDzd(p);
  return {
    monthly,
    annual,
    monthlyPremium: discounted(monthly, p.premiumDiscountRate),
    annualPremium: discounted(annual, p.premiumDiscountRate),
  };
}

/** Why a course price is refused, or null when it is valid. */
export function coursePriceError(priceDzd: unknown): 'NOT_A_NUMBER' | 'BELOW_MINIMUM' | 'TOO_HIGH' | null {
  if (typeof priceDzd !== 'number' || !Number.isInteger(priceDzd)) return 'NOT_A_NUMBER';
  if (priceDzd < ACADEMY_MIN_COURSE_PRICE_DZD) return 'BELOW_MINIMUM';
  if (priceDzd > ACADEMY_MAX_PRICE_DZD) return 'TOO_HIGH';
  return null;
}

/** A rate the admin may set: a fraction strictly inside 0–1. */
export function isValidRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 1;
}

/**
 * The mentor's share for a new sale or statement: their own override, else the
 * platform default. Copied onto the sale when it is created, so changing either
 * never rewrites money already earned.
 */
export function mentorShareRate(mentor: { academyShareRate?: number | null } | null | undefined, p: AcademyPricing): number {
  const own = mentor?.academyShareRate;
  return isValidRate(own) ? own : p.defaultMentorShareRate;
}

/* ─────────────────────────── Buying ─────────────────────────── */

/** Accounts that can buy courses and the Pass (owner: entrepreneurs and freelancers). */
export const ACADEMY_BUYER_ROLES = ['ENTREPRENEUR', 'FREELANCER'] as const;

export function canBuyAcademy(role: string | null | undefined): boolean {
  return (ACADEMY_BUYER_ROLES as readonly string[]).includes(role ?? '');
}

/**
 * Founder (entrepreneur) or Freelancer Premium, unexpired — the members who get
 * the Academy discount. The retired Entrepreneur plan does not count.
 */
export function isAcademyPremium(
  user: { role: string; membershipCode?: string | null; membershipTier?: string | null; membershipExpiresAt?: string | null } | null | undefined,
  now = new Date(),
): boolean {
  if (!user) return false;
  if (user.membershipExpiresAt && new Date(user.membershipExpiresAt) <= now) return false;
  // The code wins over the tier (Freelancer Premium is stored with tier FOUNDER).
  const plan = normalizePlanCode(user.membershipCode) ?? normalizePlanCode(user.membershipTier);
  if (user.role === 'ENTREPRENEUR') return plan === 'STARTUP';
  if (user.role === 'FREELANCER') return plan === 'FREELANCER_PREMIUM';
  return false;
}

export interface CourseQuote {
  listPriceDzd: number;
  amountDzd: number;
  discount: 'NONE' | 'PREMIUM';
  discountDzd: number;
}

/** What this buyer pays for a course. The ONE place a course price is computed. */
export function quoteCourse(listPriceDzd: number, pricing: AcademyPricing, premium: boolean): CourseQuote {
  if (!premium) return { listPriceDzd, amountDzd: listPriceDzd, discount: 'NONE', discountDzd: 0 };
  const amountDzd = discounted(listPriceDzd, pricing.premiumDiscountRate);
  return { listPriceDzd, amountDzd, discount: 'PREMIUM', discountDzd: listPriceDzd - amountDzd };
}

export type PassPlan = 'MONTHLY' | 'ANNUAL';

export interface PassQuote extends CourseQuote { plan: PassPlan }

/** What this buyer pays for a Pass term. The ONE place a Pass price is computed. */
export function quotePass(plan: PassPlan, pricing: AcademyPricing, premium: boolean): PassQuote {
  const prices = passPrices(pricing);
  const list = plan === 'ANNUAL' ? prices.annual : prices.monthly;
  return { plan, ...quoteCourse(list, pricing, premium) };
}

/** Refund rule (owner): within 7 days, under 25 % of the course watched, no certificate. */
export const ACADEMY_REFUND_DAYS = 7;
export const ACADEMY_REFUND_MAX_WATCHED = 0.25;

export function refundWindowEndsAt(purchasedAt: string): Date {
  return new Date(new Date(purchasedAt).getTime() + ACADEMY_REFUND_DAYS * 24 * 3600 * 1000);
}

/* ─────────────────────────── Watch time ─────────────────────────── */

/** Africa/Algiers calendar day (UTC+1, no DST) of an instant — the watch ledger's day. */
export function algiersDay(at: string | Date = new Date()): string {
  const t = typeof at === 'string' ? new Date(at).getTime() : at.getTime();
  return new Date(t + 3600_000).toISOString().slice(0, 10);
}

/** The player reports every 30 s; a report can never credit more than this. */
export const WATCH_HEARTBEAT_MAX_SEC = 35;
/** A lesson counts at most this many times its length per person per day. */
export const WATCH_DAILY_LESSON_FACTOR = 2;

/**
 * The two limits on one heartbeat: what it may add at most (wall time since
 * the previous report, capped), and the day's ceiling for that lesson (twice
 * its length). Storage applies them atomically; see `creditableWatchSeconds`.
 */
export function watchCaps(elapsedSec: number, lessonDurationSec: number): { add: number; dailyCap: number } {
  const elapsed = Number.isFinite(elapsedSec) ? Math.floor(elapsedSec) : 0;
  return {
    add: Math.max(0, Math.min(elapsed, WATCH_HEARTBEAT_MAX_SEC)),
    dailyCap: Math.max(0, Math.floor(lessonDurationSec) * WATCH_DAILY_LESSON_FACTOR),
  };
}

/**
 * Seconds a heartbeat may add for one person, one lesson, one day, given what
 * is already counted today. Looping a video earns nothing past the cap.
 */
export function creditableWatchSeconds(input: {
  elapsedSec: number;
  alreadyTodaySec: number;
  lessonDurationSec: number;
}): number {
  const { add, dailyCap } = watchCaps(input.elapsedSec, input.lessonDurationSec);
  return Math.min(add, Math.max(0, dailyCap - Math.max(0, Math.floor(input.alreadyTodaySec))));
}

/* ─────────────────────────── Module visibility ─────────────────────────── */

type ModuleFlags = { comingSoon: boolean; pendingReview?: boolean };

/** Shown to learners at all (a mentor's module awaiting approval is not). */
export function isVisibleModule(m: ModuleFlags): boolean {
  return !m.pendingReview;
}

/** Released: visible and not announced as "coming soon" — its lessons play and count. */
export function isLiveModule(m: ModuleFlags): boolean {
  return !m.pendingReview && !m.comingSoon;
}

/* ─────────────────────────── Catalogue vocabulary ─────────────────────────── */

export const ACADEMY_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type AcademyLevel = (typeof ACADEMY_LEVELS)[number];

/** The language spoken in the videos (titles are translated; videos are not). */
export const ACADEMY_AUDIO_LANGUAGES = ['DARIJA_FR', 'FR', 'AR', 'EN'] as const;
export type AcademyAudioLanguage = (typeof ACADEMY_AUDIO_LANGUAGES)[number];

/**
 * Fields a course is filed under. Seeded into the store the first time the
 * Academy reads them; labels live in i18n (`academy.fields.<id>`).
 */
export const ACADEMY_DEFAULT_FIELDS = [
  'ideation',
  'legal',
  'tax',
  'funding',
  'marketing',
  'sales',
  'finance',
  'product',
  'leadership',
] as const;
