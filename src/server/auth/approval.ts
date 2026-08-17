/**
 * Centralized account-approval service.
 *
 * The single logic path for an admin approving or rejecting a gated account
 * (INCUBATOR / INVESTOR). It is called by both the unified admin approvals
 * route and the legacy investor route, so the behaviour never diverges:
 *
 *   1. Set the unified write-gate field `approvalStatus` (+ rejection reason).
 *   2. Sync the legacy per-surface gate so every surface unlocks together:
 *        INVESTOR  → user.investorStatus
 *        INCUBATOR → their IncubatorRecord.status
 *   3. Append an audit-log entry.
 *   4. Fire a role-appropriate approval/rejection email (fire-and-forget — a
 *      mail failure never rolls back the approval).
 *
 * The mutation is idempotent: re-approving an already-approved account is a
 * no-op beyond refreshing `updatedAt`.
 */
import { db, type UserRecord } from '@/server/db/store';
import { isApprovalGatedRole } from '@/lib/approval-guard';
import { appendAuditLog } from '@/server/audit/service';
import {
  sendInvestorApprovalEmail,
  sendInvestorRejectionEmail,
  sendIncubatorApprovalEmail,
  sendIncubatorRejectionEmail,
} from '@/server/notifications/email';

export type AccountApprovalDecision = 'APPROVED' | 'REJECTED';

export interface SetAccountApprovalInput {
  userId: string;
  decision: AccountApprovalDecision;
  /** Required (non-empty) when decision === 'REJECTED'. */
  reason?: string | null;
  admin: { id: string; email: string };
}

export type SafeUser = Omit<UserRecord, 'passwordHash'>;

export type SetAccountApprovalResult =
  | { ok: true; user: SafeUser }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_GATED' };

type EmailSurface = 'INVESTOR' | 'INCUBATOR';
type EmailSideEffect =
  | { kind: 'APPROVED'; surface: EmailSurface; to: string; name: string; lang: 'en' | 'fr' | 'ar' }
  | { kind: 'REJECTED'; surface: EmailSurface; to: string; name: string; lang: 'en' | 'fr' | 'ar'; reason: string };

export async function setAccountApproval(
  input: SetAccountApprovalInput,
): Promise<SetAccountApprovalResult> {
  const reason = input.reason?.trim() || '';
  let sideEffect: EmailSideEffect | null = null;

  const result = await db.update<SetAccountApprovalResult>((d) => {
    const user = (d.users ?? []).find((u) => u.id === input.userId);
    if (!user) return { ok: false, reason: 'NOT_FOUND' };
    if (!isApprovalGatedRole(user.role)) return { ok: false, reason: 'NOT_GATED' };

    const now = new Date().toISOString();
    const approved = input.decision === 'APPROVED';

    // 1) Unified write-gate.
    user.approvalStatus = input.decision;
    user.approvalRejectionReason = approved ? null : reason;

    // 2) Sync the legacy per-surface gate + capture the email side effect.
    if (user.role === 'INVESTOR') {
      user.investorStatus = approved ? 'APPROVED' : 'REJECTED';
      user.investorRejectionReason = approved ? null : reason;
      sideEffect = approved
        ? { kind: 'APPROVED', surface: 'INVESTOR', to: user.email.trim(), name: user.fullName, lang: user.locale }
        : { kind: 'REJECTED', surface: 'INVESTOR', to: user.email.trim(), name: user.fullName, lang: user.locale, reason };
    } else {
      // INCUBATOR — managed via its IncubatorRecord. Since the Business→
      // Incubator merge this covers trainers and training centres too; they
      // share the record, the gate and the email copy.
      const provider = (d.incubators ?? []).find((i) => i.managerId === user.id);
      if (provider) {
        provider.status = approved ? 'ACTIVE' : 'REJECTED';
        provider.updatedAt = now;
      }
      const providerName = provider?.name?.trim() || user.fullName;
      const surface: EmailSurface = 'INCUBATOR';
      sideEffect = approved
        ? { kind: 'APPROVED', surface, to: user.email.trim(), name: providerName, lang: user.locale }
        : { kind: 'REJECTED', surface, to: user.email.trim(), name: providerName, lang: user.locale, reason };
    }

    user.updatedAt = now;

    const { passwordHash: _ph, ...safe } = user;
    void _ph;
    return { ok: true, user: safe };
  });

  if (!result.ok) return result;

  // 3) Audit (fire-and-forget — never blocks the response).
  const auditAction =
    result.user.role === 'INVESTOR'
      ? input.decision === 'APPROVED' ? 'INVESTOR_APPROVED' : 'INVESTOR_REJECTED'
      : result.user.role === 'INCUBATOR'
        ? input.decision === 'APPROVED' ? 'INCUBATOR_APPROVED' : 'INCUBATOR_REJECTED'
        : input.decision === 'APPROVED' ? 'ACCOUNT_APPROVED' : 'ACCOUNT_REJECTED';
  void appendAuditLog({
    adminId: input.admin.id,
    adminEmail: input.admin.email,
    action: auditAction,
    targetType: 'user',
    targetId: input.userId,
    details: input.decision === 'REJECTED' ? { reason } : {},
  });

  // 4) Notify the account holder (fire-and-forget).
  const fx = sideEffect as EmailSideEffect | null;
  if (fx) {
    void (async () => {
      try {
        if (fx.kind === 'APPROVED') {
          if (fx.surface === 'INVESTOR') {
            await sendInvestorApprovalEmail({ to: fx.to, investorName: fx.name, lang: fx.lang });
          } else {
            await sendIncubatorApprovalEmail({ to: fx.to, incubatorName: fx.name, lang: fx.lang });
          }
        } else if (fx.surface === 'INVESTOR') {
          await sendInvestorRejectionEmail({ to: fx.to, investorName: fx.name, reason: fx.reason, lang: fx.lang });
        } else {
          await sendIncubatorRejectionEmail({ to: fx.to, incubatorName: fx.name, reason: fx.reason, lang: fx.lang });
        }
      } catch (err) {
        console.error('[approval] decision email failed', err);
      }
    })();
  }

  return result;
}
