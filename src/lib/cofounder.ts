/**
 * "Find my cofounder" — the options and the pure scoring rule (Metwork 2.0
 * phase 8). Client-safe: the profile form uses the same lists the server
 * validates against, and the deck is ranked with `matchScore`.
 */

export const COFOUNDER_ROLES = ['TECH', 'PRODUCT', 'DESIGN', 'BUSINESS', 'SALES', 'MARKETING', 'OPERATIONS', 'FINANCE'] as const;
export type CofounderRole = (typeof COFOUNDER_ROLES)[number];

export const COMMITMENTS = ['FULL_TIME', 'PART_TIME', 'EVENINGS'] as const;
export type Commitment = (typeof COMMITMENTS)[number];

export const SECTORS = ['AGRITECH', 'FINTECH', 'EDTECH', 'HEALTHTECH', 'ECOMMERCE', 'LOGISTICS', 'SAAS', 'TOURISM', 'ENERGY', 'INDUSTRY', 'MEDIA', 'OTHER'] as const;

/** Values quiz: each answer is 1–5 between two poles (labels in i18n `cofounder.quiz.<key>`). */
export const VALUE_KEYS = ['pace', 'risk', 'decisions', 'equity', 'workplace'] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];

export const PITCH_MIN = 40;
export const PITCH_MAX = 600;

export interface MatchProfile {
  brings: string[];
  lookingFor: string[];
  commitment: string | null;
  sectors: string[];
  remoteOk: boolean;
  values: Record<string, number>;
  /** Canonical wilaya code. */
  city: string | null;
}

/** A profile shows in decks only once it says what the person brings and seeks. */
export function isComplete(p: { brings: string[]; lookingFor: string[]; pitch: string; commitment: string | null }): boolean {
  return p.brings.length > 0 && p.lookingFor.length > 0 && p.pitch.trim().length >= PITCH_MIN && p.commitment !== null;
}

const overlap = (a: string[], b: string[]) => a.some((x) => b.includes(x));

function commitmentFit(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5;
  if (a === b) return 1;
  const rank = { FULL_TIME: 2, PART_TIME: 1, EVENINGS: 0 } as Record<string, number>;
  return Math.abs((rank[a] ?? 1) - (rank[b] ?? 1)) === 1 ? 0.5 : 0.1;
}

function valuesFit(a: Record<string, number>, b: Record<string, number>): number {
  const keys = VALUE_KEYS.filter((k) => a[k] && b[k]);
  if (!keys.length) return 0.5;
  const diff = keys.reduce((s, k) => s + Math.abs(a[k]! - b[k]!), 0) / keys.length;
  return 1 - diff / 4;
}

/**
 * 0–1. Complementary roles weigh most (each side brings what the other
 * seeks), then shared values, commitment, place and sector.
 */
export function matchScore(me: MatchProfile, them: MatchProfile): number {
  const complement = (overlap(them.brings, me.lookingFor) ? 0.5 : 0) + (overlap(me.brings, them.lookingFor) ? 0.5 : 0);
  const place = me.city && them.city && me.city === them.city ? 1 : me.remoteOk && them.remoteOk ? 0.8 : 0.3;
  const sector = !me.sectors.length || !them.sectors.length ? 0.5 : overlap(me.sectors, them.sectors) ? 1 : 0;
  return 0.4 * complement + 0.2 * valuesFit(me.values, them.values) + 0.15 * commitmentFit(me.commitment, them.commitment) + 0.15 * place + 0.1 * sector;
}

/** "Today" for decks: the Algiers calendar day (UTC+1, no DST). */
export function algiersDay(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60_000).toISOString().slice(0, 10);
}
