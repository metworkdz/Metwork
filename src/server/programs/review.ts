/**
 * Admin review of consultant programs. A consultant's new program is PENDING
 * until an admin approves it (then it is reachable and listed on /programs) or
 * rejects it with a reason (the consultant sees it, edits, and it comes back).
 * Incubator programs are never reviewed.
 */
import { db, type ProgramRecord } from '@/server/db/store';

export type ReviewDecision = 'APPROVE' | 'REJECT';

export type ReviewResult =
  | { ok: true; program: ProgramRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_CONSULTANT' | 'REASON_REQUIRED' };

export async function reviewProgram(
  programId: string,
  decision: ReviewDecision,
  admin: { id: string },
  reason?: string | null,
): Promise<ReviewResult> {
  const why = reason?.trim() || null;
  if (decision === 'REJECT' && !why) return { ok: false, reason: 'REASON_REQUIRED' };
  return db.update<ReviewResult>((d) => {
    const p = (d.programs ?? []).find((x) => x.id === programId);
    if (!p) return { ok: false, reason: 'NOT_FOUND' };
    if (!p.mentorId) return { ok: false, reason: 'NOT_CONSULTANT' };
    const now = new Date().toISOString();
    p.reviewStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    p.reviewRejectionReason = decision === 'REJECT' ? why : null;
    p.reviewedAt = now;
    p.reviewedBy = admin.id;
    p.updatedAt = now;
    return { ok: true, program: { ...p } };
  });
}

/** Consultant programs awaiting a decision — the admin queue and its badge. */
export function pendingConsultantPrograms(d: { programs?: ProgramRecord[] }): ProgramRecord[] {
  return (d.programs ?? []).filter((p) => p.mentorId && p.reviewStatus === 'PENDING');
}
