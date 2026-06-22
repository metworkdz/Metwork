/**
 * Single source of truth for the unified account-approval gate.
 *
 * INCUBATOR / INVESTOR / BUSINESS accounts created after this feature land in
 * 'PENDING' and must be approved by an admin before they can perform any write
 * action ("read-only until approved"). Every other role — and every pre-existing
 * account, which lacks the `approvalStatus` field entirely — is grandfathered as
 * APPROVED so the feature never locks out current users.
 *
 * This generalises the older investor-only guard (investor-guard.ts), which
 * remains for the investor "awaiting approval" screen; the two are kept in sync
 * by setAccountApproval().
 */
import type { ApprovalStatus, UserRole } from '@/types/auth';
import { APPROVAL_GATED_ROLES } from '@/types/auth';

type ApprovalShape = { role?: UserRole; approvalStatus?: ApprovalStatus };

/** Whether a role is subject to the approval gate at all. */
export function isApprovalGatedRole(role: UserRole | undefined): boolean {
  return role !== undefined && (APPROVAL_GATED_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve a user's effective approval state.
 *
 * - Non-gated roles (ENTREPRENEUR / ADMIN) are always APPROVED.
 * - Gated roles default to APPROVED when the field is absent (legacy accounts),
 *   so existing INCUBATOR / INVESTOR users are never retroactively locked out.
 */
export function getApprovalStatus(user: ApprovalShape): ApprovalStatus {
  if (!isApprovalGatedRole(user.role)) return 'APPROVED';
  return user.approvalStatus ?? 'APPROVED';
}

/** Whether the account may perform write/transaction actions. */
export function isAccountApproved(user: ApprovalShape): boolean {
  return getApprovalStatus(user) === 'APPROVED';
}
