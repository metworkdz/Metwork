'use client';

/**
 * UserProfileHeader
 *
 * Displays the user's avatar with a tier-coloured ring, their full name
 * with the membership badge inline, and optional meta (city, member since).
 *
 * Designed to sit at the top of the entrepreneur profile page or anywhere
 * a richer "this is me" header is needed. It is a pure presentational
 * component — pass the user object and any extra action slot via children.
 *
 * Avatar ring behaviour:
 *   Explorer → no ring
 *   Builder  → 3px gold ring + soft gold glow
 *   Founder  → 3px platinum ring + soft platinum glow + shimmer pulse
 */

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import { cn } from '@/lib/utils';
import { resolveTier, type MembershipTier } from '@/lib/tier-utils';
import type { SessionUser } from '@/types/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase();
}

/** CSS class applied to the avatar wrapper div based on tier. */
const AVATAR_RING: Record<MembershipTier, string> = {
  EXPLORER: '',
  BUILDER:  'avatar-ring-gold',
  FOUNDER:  'avatar-ring-platinum',
};

// ─── Size tokens ──────────────────────────────────────────────────────────────

const AVATAR_SIZE = {
  md: 'size-16',
  lg: 'size-20',
  xl: 'size-24',
} as const;

type AvatarSize = keyof typeof AVATAR_SIZE;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  user: SessionUser;
  /** Extra content rendered below name+badge (e.g. action buttons). */
  children?: React.ReactNode;
  avatarSize?: AvatarSize;
  /** Show city + member-since meta line. Default true. */
  showMeta?: boolean;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UserProfileHeader({
  user,
  children,
  avatarSize = 'xl',
  showMeta = true,
  className,
}: Props) {
  const tier = resolveTier(user);
  const ringClass = AVATAR_RING[tier];

  const memberSince = user.membershipStartDate
    ? new Date(user.membershipStartDate).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div className={cn('flex flex-col items-center gap-4 sm:flex-row sm:items-start', className)}>
      {/* Avatar with tier ring */}
      <div className={cn('shrink-0 rounded-full', ringClass)}>
        <Avatar className={cn(AVATAR_SIZE[avatarSize])}>
          {user.avatarUrl && (
            <AvatarImage src={user.avatarUrl} alt={user.fullName} />
          )}
          <AvatarFallback className="text-lg">{initials(user.fullName)}</AvatarFallback>
        </Avatar>
      </div>

      {/* Name + badge + meta */}
      <div className="flex flex-1 flex-col items-center gap-1 sm:items-start">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold leading-tight">{user.fullName}</h1>
          {tier !== 'EXPLORER' && (
            <MembershipTierBadge tier={tier} size="md" />
          )}
        </div>

        {showMeta && (
          <p className="text-sm text-muted-foreground">
            {[
              user.city,
              memberSince ? `Member since ${memberSince}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}

        {children && (
          <div className="mt-3 flex flex-wrap gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}
