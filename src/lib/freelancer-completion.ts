/**
 * Freelancer profile completion — THE scoring rule behind the 0–100 % ring
 * and the Premium trial unlock.
 *
 * Client-safe and pure: the page draws the ring with it and the trial route
 * re-runs it server-side on the stored records, so the browser can never
 * claim a 100 % the server did not compute.
 *
 * Weights sum to exactly 100. The approved business document carries the
 * most because it is what lets a client trust a stranger.
 */

export const COMPLETION_ITEMS = [
  { key: 'photo',     weight: 10 },
  { key: 'bio',       weight: 15 },
  { key: 'expertise', weight: 15 },
  { key: 'personal',  weight: 15 },
  { key: 'portfolio', weight: 10 },
  { key: 'document',  weight: 25 },
  { key: 'payout',    weight: 10 },
] as const;

export type CompletionKey = (typeof COMPLETION_ITEMS)[number]['key'];

export const BIO_MIN_CHARS = 80;
export const MIN_SKILLS = 3;
export const MIN_PORTFOLIO_ITEMS = 2;

export interface CompletionUser {
  fullName: string;
  phone?: string | null;
  city?: string | null;
  avatarUrl?: string | null;
  payoutAccount?: { accountNumber: string } | null;
  legalVerificationStatus?: string | null;
}

export interface CompletionProfile {
  headline: string | null;
  bio: string | null;
  skills: string[];
  address: string | null;
  portfolio: unknown[];
}

export interface CompletionResult {
  percent: number;
  items: { key: CompletionKey; weight: number; done: boolean }[];
}

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

export function computeCompletion(user: CompletionUser, profile: CompletionProfile | null): CompletionResult {
  const p = profile ?? { headline: null, bio: null, skills: [], address: null, portfolio: [] };
  const done: Record<CompletionKey, boolean> = {
    photo: filled(user.avatarUrl),
    bio: (p.bio?.trim().length ?? 0) >= BIO_MIN_CHARS,
    expertise: filled(p.headline) && p.skills.filter(filled).length >= MIN_SKILLS,
    personal: filled(user.fullName) && filled(user.phone) && filled(user.city) && filled(p.address),
    portfolio: p.portfolio.length >= MIN_PORTFOLIO_ITEMS,
    document: user.legalVerificationStatus === 'APPROVED',
    payout: !!user.payoutAccount?.accountNumber,
  };
  const items = COMPLETION_ITEMS.map(({ key, weight }) => ({ key, weight, done: done[key] }));
  const percent = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);
  return { percent, items };
}
