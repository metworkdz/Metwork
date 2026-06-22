'use client';

import { useAuth } from '@/components/providers/auth-provider';
import type { ApprovalStatus } from '@/types/auth';

/**
 * Client-side mirror of the server approval gate. Returns the current user's
 * effective approval state and a convenience `isApproved` flag, so action
 * buttons (book / pay / create / edit) can be disabled for pending accounts.
 *
 * Defaults to APPROVED when there is no session or the field is absent (legacy
 * tokens) — the server remains the source of truth and rejects writes anyway.
 */
export function useAccountApproved(): { isApproved: boolean; status: ApprovalStatus } {
  const { user } = useAuth();
  const status: ApprovalStatus = user?.approvalStatus ?? 'APPROVED';
  return { isApproved: status === 'APPROVED', status };
}
