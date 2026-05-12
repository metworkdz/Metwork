/**
 * Membership tier utilities — shared between server and client code.
 *
 * The project stores the tier in two ways depending on context:
 *   1. `membershipCode` (legacy, from SessionUser): 'FREE' | 'ENTREPRENEUR' | 'STARTUP'
 *   2. `membershipTier` (new, from UserRecord):     'EXPLORER' | 'BUILDER' | 'FOUNDER'
 *
 * These helpers normalise both representations into a single `MembershipTier`
 * enum value so the UI doesn't need to branch on both.
 */

export type MembershipTier = 'EXPLORER' | 'BUILDER' | 'FOUNDER';

/** Input duck-typed to cover both SessionUser and UserRecord. */
interface TierSource {
  membershipTier?: MembershipTier | string | null;
  membershipCode?: string | null;
}

/**
 * Resolve the effective MembershipTier for a user object.
 * Priority: explicit `membershipTier` field → derived from `membershipCode`.
 */
export function resolveTier(user: TierSource): MembershipTier {
  if (user.membershipTier) {
    const t = user.membershipTier as string;
    if (t === 'BUILDER' || t === 'FOUNDER' || t === 'EXPLORER') {
      return t as MembershipTier;
    }
  }
  switch (user.membershipCode) {
    case 'ENTREPRENEUR': return 'BUILDER';
    case 'STARTUP':      return 'FOUNDER';
    default:             return 'EXPLORER';
  }
}

/** Human-readable label for each tier. */
export const TIER_LABELS: Record<MembershipTier, string> = {
  EXPLORER: 'Explorer',
  BUILDER:  'Builder',
  FOUNDER:  'Founder',
};

/** Emoji icon for each tier. */
export const TIER_ICONS: Record<MembershipTier, string> = {
  EXPLORER: '',
  BUILDER:  '🏆',
  FOUNDER:  '👑',
};

/** Tailwind border-color utility for each tier. */
export const TIER_BORDER_CLASS: Record<MembershipTier, string> = {
  EXPLORER: 'border-zinc-200',
  BUILDER:  'border-gold-600',
  FOUNDER:  'border-platinum-300',
};

/** Tailwind text-color utility for each tier. */
export const TIER_TEXT_CLASS: Record<MembershipTier, string> = {
  EXPLORER: 'text-zinc-500',
  BUILDER:  'text-gold-700 dark:text-gold-400',
  FOUNDER:  'text-platinum-700 dark:text-platinum-400',
};

/** Tailwind background utility for each tier (low opacity). */
export const TIER_BG_CLASS: Record<MembershipTier, string> = {
  EXPLORER: 'bg-transparent',
  BUILDER:  'bg-gold-50 dark:bg-gold-900/20',
  FOUNDER:  'bg-platinum-50 dark:bg-platinum-900/20',
};

/** CSS variable for the tier accent color (for inline styles / box-shadow). */
export const TIER_CSS_VAR: Record<MembershipTier, string> = {
  EXPLORER: 'transparent',
  BUILDER:  'var(--color-gold)',
  FOUNDER:  'var(--color-platinum)',
};
