/**
 * Centralized consultant (mentor) approval service.
 *
 * The single logic path for an admin approving or rejecting a consultant —
 * mirrors `setAccountApproval` (src/server/auth/approval.ts), which gates
 * user accounts; consultants live in `MentorRecord`, so they get their own
 * thin twin rather than being shoehorned into the user gate:
 *
 *   1. Set `approvalStatus` (+ rejection reason) on the MentorRecord.
 *   2. Append an audit-log entry.
 *   3. Fire the approval/rejection email (fire-and-forget — a mail failure
 *      never rolls back the decision).
 *
 * Idempotent: re-approving an already-approved consultant is a no-op.
 */
import { db, type MentorRecord } from '@/server/db/store';
import { appendAuditLog } from '@/server/audit/service';
import {
  sendConsultantApprovalEmail,
  sendConsultantRejectionEmail,
} from '@/server/notifications/email';

export type MentorApprovalDecision = 'APPROVED' | 'REJECTED';

export interface SetMentorApprovalInput {
  mentorId: string;
  decision: MentorApprovalDecision;
  /** Required (non-empty) when decision === 'REJECTED'. */
  reason?: string | null;
  admin: { id: string; email: string };
}

export type SetMentorApprovalResult =
  | { ok: true; mentor: MentorRecord }
  | { ok: false; reason: 'NOT_FOUND' };

export async function setMentorApproval(
  input: SetMentorApprovalInput,
): Promise<SetMentorApprovalResult> {
  const reason = input.reason?.trim() || '';
  const approved = input.decision === 'APPROVED';

  const result = await db.update<SetMentorApprovalResult>((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === input.mentorId);
    if (!mentor) return { ok: false, reason: 'NOT_FOUND' };
    mentor.approvalStatus = input.decision;
    mentor.approvalRejectionReason = approved ? null : reason;
    return { ok: true, mentor };
  });

  if (!result.ok) return result;

  // Audit (fire-and-forget — never blocks the response).
  void appendAuditLog({
    adminId: input.admin.id,
    adminEmail: input.admin.email,
    action: approved ? 'MENTOR_APPROVED' : 'MENTOR_REJECTED',
    targetType: 'mentor',
    targetId: input.mentorId,
    details: approved ? {} : { reason },
  });

  // Notify the consultant (fire-and-forget; no email on file ⇒ skip silently).
  const to = result.mentor.email?.trim();
  if (to) {
    const name = result.mentor.fullName;
    void (async () => {
      try {
        if (approved) {
          await sendConsultantApprovalEmail({ to, consultantName: name });
        } else {
          await sendConsultantRejectionEmail({ to, consultantName: name, reason });
        }
      } catch (err) {
        console.error('[mentor-approval] decision email failed', err);
      }
    })();
  }

  return result;
}

export interface SetMentorPublishedInput {
  mentorId: string;
  /** true → show on the public mentors page; false → hide from lists. */
  publiclyListed: boolean;
  admin: { id: string; email: string };
}

export type SetMentorPublishedResult =
  | { ok: true; mentor: MentorRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_APPROVED' };

/**
 * Admin publish/unpublish: put a consultant on (or remove them from) the
 * public mentors page. The ONLY way a self-signed-up consultant becomes
 * publicly listed — the visibility gate (`isMentorPubliclyListed`) hides
 * SELF records unless `publiclyListed === true`. Publishing requires an
 * APPROVED profile; unpublishing is always allowed. Idempotent.
 */
export async function setMentorPublished(
  input: SetMentorPublishedInput,
): Promise<SetMentorPublishedResult> {
  const result = await db.update<SetMentorPublishedResult>((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === input.mentorId);
    if (!mentor) return { ok: false, reason: 'NOT_FOUND' };
    // Never surface an unreviewed profile on the public site.
    const approved = (mentor.approvalStatus ?? 'APPROVED') === 'APPROVED';
    if (input.publiclyListed && !approved) return { ok: false, reason: 'NOT_APPROVED' };
    mentor.publiclyListed = input.publiclyListed;
    mentor.updatedAt = new Date().toISOString();
    return { ok: true, mentor };
  });

  if (!result.ok) return result;

  // Audit (fire-and-forget — never blocks the response).
  void appendAuditLog({
    adminId: input.admin.id,
    adminEmail: input.admin.email,
    action: input.publiclyListed ? 'MENTOR_PUBLISHED' : 'MENTOR_UNPUBLISHED',
    targetType: 'mentor',
    targetId: input.mentorId,
    details: {},
  });

  return result;
}
