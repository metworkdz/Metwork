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

/* ─────────────────────────── Watch time ─────────────────────────── */

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
