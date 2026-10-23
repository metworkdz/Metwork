/**
 * Member badges — which badge, if any, a member shows next to their name.
 *
 *   GOLD      entrepreneur on an active Founder plan
 *   VERIFIED  freelancer on an active Premium plan WHOSE business document
 *             (auto-entrepreneur card or RC) is approved. Premium alone never
 *             shows it: a "verified" mark on someone nobody checked would
 *             mislead the clients who rely on it.
 *
 * The one place this rule lives. Client-safe.
 */
import { normalizePlanCode } from '@/lib/membership-benefits';
import type { LegalVerificationStatus, UserRole } from '@/types/auth';

export type MemberBadge = 'GOLD' | 'VERIFIED';

export interface BadgeUser {
  role: UserRole;
  membershipCode?: string | null;
  membershipTier?: string | null;
  membershipExpiresAt?: string | null;
  legalVerificationStatus?: LegalVerificationStatus | null;
}

export function memberBadgeFor(user: BadgeUser | null | undefined, now = new Date()): MemberBadge | null {
  if (!user) return null;
  if (user.membershipExpiresAt && new Date(user.membershipExpiresAt) <= now) return null;
  const plan = normalizePlanCode(user.membershipCode) ?? normalizePlanCode(user.membershipTier);
  if (user.role === 'ENTREPRENEUR' && plan === 'STARTUP') return 'GOLD';
  if (
    user.role === 'FREELANCER' &&
    plan === 'FREELANCER_PREMIUM' &&
    user.legalVerificationStatus === 'APPROVED'
  ) {
    return 'VERIFIED';
  }
  return null;
}
