/**
 * Membership service — tier logic, quotas, and discounts.
 *
 * Source of truth for:
 *   - Effective membership code (checks expiry)
 *   - Per-tier consultation free quota
 *   - Per-tier space booking discount
 *   - Membership prices
 */
import { db } from '@/server/db/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal interface required to compute the effective membership code. */
export interface MembershipUserLike {
  membershipCode: string | null;
  membershipExpiresAt?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Free monthly consultation quota per membership tier. */
export const CONSULTATION_QUOTA: Record<string, number> = {
  ENTREPRENEUR: 1,
  STARTUP: 3,
};

/** Space booking discount fraction per membership tier (e.g. 0.20 = 20 % off). */
export const SPACE_DISCOUNT: Record<string, number> = {
  STARTUP: 0.2,
};

/** Membership prices in integer DZD. */
export const MEMBERSHIP_PRICES: Record<string, { monthly: number; yearly: number }> = {
  ENTREPRENEUR: { monthly: 4_500, yearly: Math.round(4_500 * 12 * 0.7) },
  STARTUP:      { monthly: 8_000, yearly: Math.round(8_000 * 12 * 0.7) },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentQuotaMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Return the user's *effective* membership code, taking expiry into account.
 * Returns 'FREE' when the membership has expired or is null.
 * Accepts any object with `membershipCode` and optional `membershipExpiresAt`
 * (works with both `UserRecord` and `SessionUser`).
 */
export function getEffectiveMembershipCode(user: MembershipUserLike): string {
  if (!user.membershipCode) return 'FREE';
  if (user.membershipExpiresAt && new Date(user.membershipExpiresAt) <= new Date()) {
    return 'FREE';
  }
  return user.membershipCode;
}

/**
 * Get a user's consultation quota usage for the current calendar month.
 */
export async function getUserConsultationQuota(userId: string): Promise<{
  quota: number;
  used: number;
  remaining: number;
  quotaMonth: string;
}> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return { quota: 0, used: 0, remaining: 0, quotaMonth: currentQuotaMonth() };

  const effectiveCode = getEffectiveMembershipCode(user);
  const quota = CONSULTATION_QUOTA[effectiveCode] ?? 0;
  const month = currentQuotaMonth();

  const used = (data.mentorConsultations ?? []).filter(
    (c) =>
      c.userId === userId &&
      c.quotaMonth === month &&
      c.chargeType === 'FREE_QUOTA' &&
      c.status !== 'CANCELLED',
  ).length;

  return { quota, used, remaining: Math.max(0, quota - used), quotaMonth: month };
}

/**
 * Compute the space-booking discount percentage for a given user (0 if none).
 */
export async function getSpaceDiscountForUser(userId: string): Promise<number> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return 0;
  const effectiveCode = getEffectiveMembershipCode(user);
  return SPACE_DISCOUNT[effectiveCode] ?? 0;
}
