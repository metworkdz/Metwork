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

/* ─────────────────────────── Learning (phase 5) ─────────────────────────── */
/*
 * Owner decisions of 2026-11-01:
 *   - certificate = every released lesson watched to 90 % (watch time counted
 *     on the server, not the "mark as done" button) AND every module quiz
 *     passed at 70 %, retries allowed;
 *   - reviews by learners (buyers or Pass) who watched 25 % of the course, live
 *     at once, the admin can hide them, the mentor replies once;
 *   - lesson Q&A is public to the course's learners.
 */
export const ACADEMY_CERT_LESSON_WATCHED = 0.9;
export const ACADEMY_QUIZ_PASS_SCORE = 0.7;
export const ACADEMY_REVIEW_MIN_WATCHED = 0.25;

/** Quiz limits, shared by the builder and the server. */
export const ACADEMY_QUIZ_MAX_QUESTIONS = 20;
export const ACADEMY_QUIZ_MIN_OPTIONS = 2;
export const ACADEMY_QUIZ_MAX_OPTIONS = 5;

/** Score of one attempt, 0–1. An empty quiz never passes. */
export function quizScore(correctIndexes: number[], answers: number[]): number {
  if (correctIndexes.length === 0) return 0;
  const right = correctIndexes.filter((c, i) => answers[i] === c).length;
  return right / correctIndexes.length;
}

export function isQuizPassed(score: number): boolean {
  return score + 1e-9 >= ACADEMY_QUIZ_PASS_SCORE;
}

/**
 * Fastest playback speed the player offers. Watch time is wall-clock time, so a
 * learner at 2× covers 90 % of a lesson in 45 % of its length: the rule below
 * must not punish them for it.
 */
export const ACADEMY_MAX_PLAYBACK_RATE = 2;

/** A lesson counts towards the certificate once 90 % of it was watched (at up to 2×). */
export function isLessonWatched(watchedSec: number, durationSec: number): boolean {
  if (durationSec <= 0) return false;
  return watchedSec * ACADEMY_MAX_PLAYBACK_RATE >= durationSec * ACADEMY_CERT_LESSON_WATCHED;
}

/* ─────────────────────────── Growth (phase 6) ─────────────────────────── */
/*
 * Owner decisions of 2026-11-02:
 *   - incubators buy Pass seats from their wallet, cheaper per seat in bulk
 *     (default −10 % from 10 seats, −20 % from 25; admin-editable); the mentors'
 *     share stays on the FULL Pass price;
 *   - a course or a Pass month can be gifted; unclaimed after 30 days it goes
 *     back to the buyer's wallet; claimed, it is final;
 *   - bundles: admin-priced learning paths; each mentor earns their share of
 *     their course's FULL list price (Metwork absorbs the bundle discount);
 *   - referral: the new member gets 10 % off their first Academy purchase, the
 *     referrer 10 % of what they paid (max 1 000 DA), after the refund window.
 */
export interface SeatTier { minSeats: number; discountRate: number }

export const ACADEMY_DEFAULT_SEAT_TIERS: SeatTier[] = [
  { minSeats: 10, discountRate: 0.1 },
  { minSeats: 25, discountRate: 0.2 },
];
export const ACADEMY_MAX_SEATS = 500;
export const ACADEMY_MAX_SEAT_MONTHS = 12;

/** The best tier the seat count reaches (0 below the first tier). */
export function seatDiscountRate(seats: number, tiers: SeatTier[]): number {
  return tiers.filter((t) => seats >= t.minSeats).reduce((best, t) => Math.max(best, t.discountRate), 0);
}

/** Tiers an admin may save: ascending seat counts, rates strictly inside 0–1, at most 5. */
export function validSeatTiers(tiers: unknown): tiers is SeatTier[] {
  if (!Array.isArray(tiers) || tiers.length > 5) return false;
  let prev = 1;
  for (const t of tiers) {
    if (!t || typeof t !== 'object') return false;
    const { minSeats, discountRate } = t as SeatTier;
    if (!Number.isInteger(minSeats) || minSeats <= prev || minSeats > ACADEMY_MAX_SEATS || !isValidRate(discountRate)) return false;
    prev = minSeats;
  }
  return true;
}

export interface SeatQuote { seats: number; months: number; unitListPriceDzd: number; unitPriceDzd: number; discountRate: number; amountDzd: number }

/** What an incubator pays for `seats` Pass seats over `months` months. The ONE place a seat price is computed. */
export function quoteSeats(seats: number, months: number, monthlyPassPriceDzd: number, tiers: SeatTier[]): SeatQuote {
  const discountRate = seatDiscountRate(seats, tiers);
  const unitPriceDzd = discounted(monthlyPassPriceDzd, discountRate);
  return { seats, months, unitListPriceDzd: monthlyPassPriceDzd, unitPriceDzd, discountRate, amountDzd: unitPriceDzd * seats * months };
}

export const ACADEMY_GIFT_CLAIM_DAYS = 30;

export const ACADEMY_REFERRAL_DISCOUNT_RATE = 0.1;
export const ACADEMY_REFERRAL_REWARD_RATE = 0.1;
export const ACADEMY_REFERRAL_REWARD_CAP_DZD = 1000;

export function referralDiscountDzd(amountDzd: number): number {
  return dinars(amountDzd * ACADEMY_REFERRAL_DISCOUNT_RATE);
}

export function referralRewardDzd(paidDzd: number): number {
  return Math.min(ACADEMY_REFERRAL_REWARD_CAP_DZD, dinars(Math.max(0, paidDzd) * ACADEMY_REFERRAL_REWARD_RATE));
}

/**
 * Split a bundle price over its courses by list-price weight, to the dinar,
 * the remainder on the last course. Used for refunds course by course.
 */
export function allocateBundle(priceDzd: number, listPrices: number[]): number[] {
  const total = listPrices.reduce((s, p) => s + p, 0);
  if (total <= 0 || listPrices.length === 0) return listPrices.map(() => 0);
  const parts = listPrices.map((p) => Math.floor((priceDzd * p) / total));
  parts[parts.length - 1]! += priceDzd - parts.reduce((s, p) => s + p, 0);
  return parts;
}
