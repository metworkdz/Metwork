/**
 * The hiring directory — THE rule for who is listed and in what order
 * (Metwork 2.0 phase 7). Pure over a store snapshot: the hiring tab, the AI
 * matcher and the tests rank with the same code.
 *
 * Listed: active freelancers whose profile says what they do (a headline and
 * at least MIN_SKILLS skills). Shown: what a client needs to choose — never
 * the address, phone, email or the business document.
 *
 * Premium priority (approved rule): among freelancers whose score clears a
 * quality bar, Premium ranks higher. A weak Premium match never beats a
 * strong Free one, so founders can keep trusting the list.
 */
import type { db, FreelancerPortfolioItem } from '@/server/db/store';
import { computeCompletion, MIN_SKILLS } from '@/lib/freelancer-completion';
import { hasPaidPlanForAudience } from '@/lib/entitlements';
import { memberBadgeFor, type MemberBadge } from '@/lib/member-badge';
import { tokenize } from '@/lib/text-search';
import { findCityCode } from '@/config/cities';
import { reviewsOf, type ReviewSummary } from '@/server/orders/reviews';

type Store = Awaited<ReturnType<typeof db.read>>;

export interface FreelancerCard {
  id: string;
  name: string;
  avatarUrl: string | null;
  headline: string;
  /** Canonical wilaya code (`config/cities`), null when the stored value is unknown. */
  city: string | null;
  remote: boolean;
  skills: string[];
  languages: string[];
  dayRate: number | null;
  /** Cheapest active gig, DZD. */
  fromPrice: number | null;
  gigCount: number;
  portfolioCount: number;
  completion: number;
  verified: boolean;
  premium: boolean;
  badge: MemberBadge | null;
  /** From reviews on paid orders; null until the first one. */
  rating: number | null;
  reviewCount: number;
}

export interface GigView {
  id: string;
  title: string;
  description: string;
  price: number;
  deliveryDays: number;
  revisions: number;
}

export interface FreelancerProfileView extends FreelancerCard {
  reviews: ReviewSummary['items'];
  bio: string | null;
  portfolio: FreelancerPortfolioItem[];
  gigs: GigView[];
  memberSince: string;
}

/** What a founder is looking for — typed by hand (filters) or extracted by the matcher. */
export interface HiringNeed {
  skills: string[];
  keywords: string[];
  budgetMax: number | null;
  wilaya: string | null;
  remoteOk: boolean;
}

export interface DirectoryFilters {
  q?: string;
  city?: string;
  maxPrice?: number;
  remote?: boolean;
  verified?: boolean;
}

/* ─────────────────────────── Listing ─────────────────────────── */

function cards(data: Store): { card: FreelancerCard; terms: Set<string>; skillTerms: Set<string> }[] {
  const out: { card: FreelancerCard; terms: Set<string>; skillTerms: Set<string> }[] = [];
  for (const p of data.freelancerProfiles ?? []) {
    const u = data.users.find((x) => x.id === p.userId);
    if (!u || u.role !== 'FREELANCER' || u.status !== 'ACTIVE') continue;
    const skills = p.skills.filter((s) => s.trim());
    if (!p.headline?.trim() || skills.length < MIN_SKILLS) continue;
    const gigs = (data.gigs ?? []).filter((g) => g.freelancerId === u.id && g.isActive);
    const reviews = reviewsOf(data, u.id);
    const card: FreelancerCard = {
      id: u.id,
      name: u.fullName,
      avatarUrl: u.avatarUrl ?? null,
      headline: p.headline.trim(),
      city: findCityCode(u.city),
      remote: p.remote,
      skills,
      languages: p.languages,
      dayRate: p.dayRate,
      fromPrice: gigs.length ? Math.min(...gigs.map((g) => g.price)) : null,
      gigCount: gigs.length,
      portfolioCount: p.portfolio.length,
      completion: computeCompletion(u, p).percent,
      verified: u.legalVerificationStatus === 'APPROVED',
      premium: hasPaidPlanForAudience(u),
      badge: memberBadgeFor(u),
      rating: reviews.average,
      reviewCount: reviews.count,
    };
    const text = [card.headline, skills.join(' '), p.bio ?? '', gigs.map((g) => `${g.title} ${g.description}`).join(' '), p.portfolio.map((x) => x.title).join(' ')].join(' ');
    out.push({ card, terms: new Set(tokenize(text)), skillTerms: new Set(tokenize(`${skills.join(' ')} ${card.headline}`)) });
  }
  return out;
}

export function isListed(data: Store, freelancerId: string): boolean {
  return cards(data).some((c) => c.card.id === freelancerId);
}

/* ─────────────────────────── Scoring ─────────────────────────── */

/** 0–1. How much of what was asked the freelancer covers; skills count double. */
function relevance(need: HiringNeed, terms: Set<string>, skillTerms: Set<string>): number {
  const wanted = [...new Set(tokenize([...need.skills, ...need.keywords].join(' ')))];
  if (!wanted.length) return 1;
  let hit = 0;
  for (const t of wanted) hit += skillTerms.has(t) ? 1 : terms.has(t) ? 0.6 : 0;
  return Math.min(1, hit / wanted.length);
}

function priceFit(need: HiringNeed | null, card: FreelancerCard): number {
  const price = card.fromPrice ?? card.dayRate;
  if (!need?.budgetMax || !price) return 0.7;
  if (price <= need.budgetMax) return 1;
  return Math.max(0, 1 - (price - need.budgetMax) / need.budgetMax);
}

function placeFit(need: HiringNeed | null, card: FreelancerCard): number {
  if (!need?.wilaya) return 1;
  if (card.city === need.wilaya) return 1;
  return need.remoteOk && card.remote ? 0.85 : 0.4;
}

function quality(card: FreelancerCard): number {
  // Reviews come from paid orders only; they count once there are a few.
  const reviews = card.rating !== null && card.reviewCount >= 2 ? ((card.rating - 3) / 2) * 0.15 : 0;
  return Math.max(0, Math.min(1, card.completion / 100 + (card.verified ? 0.1 : 0) + Math.min(card.gigCount, 3) * 0.03 + reviews));
}

/** Below this, a word in passing (a bio mentioning "site") is not a match. */
export const MIN_RELEVANCE = 0.25;

/** Premium boost applies only to scores at or above this share of the best one. */
export const QUALITY_BAR = 0.7;
export const PREMIUM_BOOST = 1.15;

export interface RankedFreelancer {
  card: FreelancerCard;
  score: number;
  /** The score before the Premium boost. */
  base: number;
}

/**
 * Rank listed freelancers for a need (or for browsing, with no need).
 * With a need, freelancers who barely match it (MIN_RELEVANCE) are left out.
 */
export function rankFreelancers(data: Store, need: HiringNeed | null, filters: DirectoryFilters = {}): RankedFreelancer[] {
  const q = filters.q?.trim() ? tokenize(filters.q) : [];
  const city = filters.city ? findCityCode(filters.city) : null;
  const scored = cards(data)
    .filter(({ card, terms }) =>
      (!filters.city || card.city === city)
      && (!filters.remote || card.remote)
      && (!filters.verified || card.verified)
      && (!filters.maxPrice || (card.fromPrice ?? card.dayRate ?? 0) <= filters.maxPrice)
      && q.every((t) => terms.has(t)),
    )
    .flatMap(({ card, terms, skillTerms }) => {
      const rel = need ? relevance(need, terms, skillTerms) : 1;
      if (need && rel < MIN_RELEVANCE) return [];
      const base = need
        ? 0.6 * rel + 0.15 * priceFit(need, card) + 0.1 * placeFit(need, card) + 0.15 * quality(card)
        : quality(card);
      return [{ card, base }];
    });
  const top = Math.max(0, ...scored.map((s) => s.base));
  const bar = top * QUALITY_BAR;
  return scored
    .map(({ card, base }) => ({ card, base, score: card.premium && base >= bar ? base * PREMIUM_BOOST : base }))
    .sort((a, b) => b.score - a.score || b.base - a.base || a.card.name.localeCompare(b.card.name));
}

/* ─────────────────────────── Profile ─────────────────────────── */

export function freelancerProfile(data: Store, freelancerId: string): FreelancerProfileView | null {
  const entry = cards(data).find((c) => c.card.id === freelancerId);
  if (!entry) return null;
  const p = data.freelancerProfiles!.find((x) => x.userId === freelancerId)!;
  const u = data.users.find((x) => x.id === freelancerId)!;
  return {
    ...entry.card,
    reviews: reviewsOf(data, freelancerId).items.slice(0, 20),
    bio: p.bio,
    portfolio: p.portfolio,
    gigs: (data.gigs ?? [])
      .filter((g) => g.freelancerId === freelancerId && g.isActive)
      .sort((a, b) => a.price - b.price)
      .map(({ id, title, description, price, deliveryDays, revisions }) => ({ id, title, description, price, deliveryDays, revisions })),
    memberSince: u.createdAt,
  };
}
