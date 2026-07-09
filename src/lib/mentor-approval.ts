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

type MentorListingShape = MentorApprovalShape & {
  source?: 'ADMIN' | 'SELF';
  publiclyListed?: boolean;
};

/**
 * Resolve a mentor's effective approval state. Absent field ⇒ APPROVED
 * (legacy admin-added mentors were implicitly vetted at creation).
 */
export function getMentorApprovalStatus(mentor: MentorApprovalShape): ApprovalStatus {
  return mentor.approvalStatus ?? 'APPROVED';
}

/** Whether the mentor is approved (bookable / reachable via direct slug link). */
export function isMentorApproved(mentor: MentorApprovalShape): boolean {
  return getMentorApprovalStatus(mentor) === 'APPROVED';
}

/**
 * Whether the mentor appears on public LIST surfaces (mentors page, landing
 * carousel, `GET /api/mentors`). Stricter than `isMentorApproved`:
 * self-signed-up consultants are hidden BY DEFAULT — even once approved —
 * and only reachable via their direct slug/booking link, UNLESS an admin
 * explicitly publishes them (`publiclyListed: true`, the "add to the public
 * mentors page" action). Absent fields ⇒ legacy admin-added mentor ⇒ listed,
 * so nothing existing ever disappears. Approval is always required.
 */
export function isMentorPubliclyListed(mentor: MentorListingShape): boolean {
  if (mentor.publiclyListed === false) return false;
  if (mentor.source === 'SELF' && mentor.publiclyListed !== true) return false;
  return isMentorApproved(mentor);
}
