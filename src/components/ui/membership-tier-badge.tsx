/**
 * MembershipTierBadge
 *
 * Renders the user's membership tier as a compact, elegantly-styled pill.
 *
 *   Explorer     — neutral gray, no background, no icon
 *   Entrepreneur — gold text + border + soft gold background
 *   Startup      — platinum text + border + soft platinum background + shimmer
 *
 * Accepts either a `tier` prop directly or a `user` duck-type from which the
 * tier is resolved, so the component works everywhere without the caller
 * needing to import tier-utils.
 */

import { cn } from '@/lib/utils';
import {
  resolveTier,
  TIER_LABELS,
  TIER_ICONS,
  type MembershipTier,
} from '@/lib/tier-utils';

// ─── Size tokens ─────────────────────────────────────────────────────────────

const SIZE_CLASSES = {
  xs: 'gap-0.5 px-1.5 py-0.5 text-[10px] leading-none',
  sm: 'gap-1   px-2   py-0.5 text-xs',
  md: 'gap-1   px-2.5 py-1   text-xs',
  lg: 'gap-1.5 px-3   py-1.5 text-sm',
} as const;

type BadgeSize = keyof typeof SIZE_CLASSES;

// ─── Tier-specific style tokens ───────────────────────────────────────────────

const TIER_STYLES: Record<
  MembershipTier,
  { badge: string; shimmer: boolean }
> = {
  EXPLORER: {
    badge: [
      'border-transparent',
      'bg-transparent',
      'text-zinc-400 dark:text-zinc-500',
    ].join(' '),
    shimmer: false,
  },
  BUILDER: {
    badge: [
      'border border-gold-600/60',
      'bg-gold-50 dark:bg-gold-900/20',
      'text-gold-700 dark:text-gold-400',
      'font-semibold',
    ].join(' '),
    shimmer: false,
  },
  FOUNDER: {
    badge: [
      'border border-platinum-300/80 dark:border-platinum-600/60',
      'bg-platinum-50 dark:bg-platinum-900/20',
      'text-platinum-700 dark:text-platinum-400',
      'font-semibold',
    ].join(' '),
    shimmer: true,
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Explicit tier — use when already resolved. */
  tier?: MembershipTier;
  /** Duck-typed user object — tier is derived when `tier` prop is absent. */
  user?: { membershipTier?: string | null; membershipCode?: string | null };
  size?: BadgeSize;
  /** Whether to show the tier emoji icon. Default true. */
  showIcon?: boolean;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MembershipTierBadge({
  tier: tierProp,
  user,
  size = 'md',
  showIcon = true,
  className,
}: Props) {
  const tier: MembershipTier = tierProp ?? (user ? resolveTier(user) : 'EXPLORER');
  const { badge, shimmer } = TIER_STYLES[tier];
  const icon = TIER_ICONS[tier];
  const label = TIER_LABELS[tier];

  // Explorer with no icon → nothing worth showing; bail early.
  if (tier === 'EXPLORER' && !showIcon) {
    return null;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full',
        SIZE_CLASSES[size],
        badge,
        shimmer && 'founder-shimmer',
        className,
      )}
    >
      {showIcon && icon && (
        <span className="shrink-0 leading-none" aria-hidden>
          {icon}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}
