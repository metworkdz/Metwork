'use client';

import { BadgeCheck, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { MemberBadge as MemberBadgeKind } from '@/lib/member-badge';

/**
 * The badge next to a member's name: gold for Founder, verified for approved
 * Premium freelancers. Which badge applies is decided by `memberBadgeFor`;
 * this only draws it. Renders nothing for `null`, so callers can pass the
 * resolver's result straight through.
 */
export function MemberBadge({
  badge,
  className,
}: {
  badge: MemberBadgeKind | null;
  className?: string;
}) {
  const t = useTranslations('membership.badges');
  if (!badge) return null;
  const label = badge === 'GOLD' ? t('gold') : t('verified');
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full align-[-2px]',
        badge === 'GOLD' ? 'bg-gold-600 text-[#0D0D0D]' : 'bg-sky-600 text-white',
        className,
      )}
    >
      {badge === 'GOLD' ? (
        <Star className="size-2.5 fill-current" strokeWidth={2.5} />
      ) : (
        <BadgeCheck className="size-3" strokeWidth={2.5} />
      )}
    </span>
  );
}
