/**
 * Single source of truth for investor approval state.
 *
 * Investor accounts created after the approval feature land in 'PENDING_APPROVAL'
 * and must be approved by an admin before they can use the gated investor
 * surfaces. Pre-existing investors lack the `investorStatus` field entirely and
 * are grandfathered as APPROVED so the feature never locks out current users.
 */
import type { UserRecord } from '@/server/db/store';

export type InvestorApproval = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

/** Resolve a user's effective investor approval state (default APPROVED). */
export function getInvestorApproval(
  user: Pick<UserRecord, 'investorStatus'> | { investorStatus?: InvestorApproval },
): InvestorApproval {
  return user.investorStatus ?? 'APPROVED';
}

/** Whether the investor has full access to gated investor surfaces. */
export function isInvestorApproved(
  user: Pick<UserRecord, 'investorStatus'> | { investorStatus?: InvestorApproval },
): boolean {
  return getInvestorApproval(user) === 'APPROVED';
}
