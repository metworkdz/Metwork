/**
 * Single source of truth for the consultant (mentor) approval gate.
 *
 * Self-signed-up consultants land in 'PENDING' and must be approved by an
 * admin before they appear on the public mentors page or accept bookings.
 * Admin-added mentors predate the `approvalStatus` field entirely and are
 * grandfathered as APPROVED so nothing existing ever disappears.
 *
 * Pure & client-safe — mirrors `approval-guard.ts` (the user-account gate).
 */
import type { ApprovalStatus } from '@/types/auth';

type MentorApprovalShape = { approvalStatus?: ApprovalStatus | null };

/**
 * Resolve a mentor's effective approval state. Absent field ⇒ APPROVED
 * (legacy admin-added mentors were implicitly vetted at creation).
 */
export function getMentorApprovalStatus(mentor: MentorApprovalShape): ApprovalStatus {
  return mentor.approvalStatus ?? 'APPROVED';
}

/** Whether the mentor is publicly listable / bookable. */
export function isMentorApproved(mentor: MentorApprovalShape): boolean {
  return getMentorApprovalStatus(mentor) === 'APPROVED';
}
