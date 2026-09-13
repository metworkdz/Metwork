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
import { sendConsultantWelcomeEmail } from '@/server/notifications/mock';

/**
 * Where the welcome email sends the consultant.
 *
 * The real public origin, not NEXT_PUBLIC_APP_URL: an email is opened by an
 * external mail client that can never resolve a localhost or preview URL.
 */
const CONSULTANT_PORTAL_URL = 'https://metwork.dz/mentordashboard';

export type MentorApprovalDecision = 'APPROVED' | 'REJECTED';

export interface SetMentorApprovalInput {
  mentorId: string;
  decision: MentorApprovalDecision;
  /** Required (non-empty) when decision === 'REJECTED'. */
  reason?: string | null;
  admin: { id: string; email: string };
}

export type SetMentorApprovalResult =
  | {
      ok: true;
      mentor: MentorRecord;
      /** True when this is the consultant's FIRST approval — the welcome email. */
      firstApproval: boolean;
    }
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
    // Claim the welcome email inside the SAME write that flips the status, so
    // two admins hitting Approve at once cannot both send it (and cannot both
    // attach 4 MB). Released again below if the send then fails.
    const firstApproval = approved && !mentor.welcomeEmailSentAt;
    if (firstApproval) mentor.welcomeEmailSentAt = new Date().toISOString();
    return { ok: true, mentor, firstApproval };
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

  // Notify the consultant. AWAITED, not fire-and-forget: on Vercel the lambda
  // is frozen the moment the response is returned, so a floating send is simply
  // never delivered — which is how an approval email silently fails to arrive.
  // Self-catching, so a mail failure can never roll back a decision that has
  // already been written. No email on file ⇒ skip silently.
  const to = result.mentor.email?.trim();
  if (to) {
    const name = result.mentor.fullName;
    try {
      if (result.firstApproval) {
        // The welcome email says "compte approuvé" and carries the starter
        // guide — it REPLACES the short approval note on a first approval
        // rather than arriving alongside it.
        const delivered = await sendConsultantWelcomeEmail(to, {
          fullName: name,
          portalUrl: CONSULTANT_PORTAL_URL,
        });
        if (!delivered) {
          // Release the claim. The stamp exists to prevent a DUPLICATE welcome,
          // not to swallow one that never went out; a later re-approval retries.
          await db.update((d) => {
            const m = (d.mentors ?? []).find((x) => x.id === input.mentorId);
            if (m) m.welcomeEmailSentAt = null;
          });
        }
      } else if (approved) {
        // A re-approval (reversing a rejection, say). They have already had the
        // welcome; the short localized note is the right message here.
        await sendConsultantApprovalEmail({ to, consultantName: name });
      } else {
        await sendConsultantRejectionEmail({ to, consultantName: name, reason });
      }
    } catch (err) {
      console.error('[mentor-approval] decision email failed', err);
    }
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
