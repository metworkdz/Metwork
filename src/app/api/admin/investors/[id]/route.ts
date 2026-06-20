/**
 * PATCH /api/admin/investors/:id — approve or reject an investor (admin only).
 *
 *   { status: 'APPROVED' }                       → grant full access + email
 *   { status: 'REJECTED', reason: '<text>' }     → block gated surfaces + email
 *
 * Email sends are fire-and-forget and never block/fail the response.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendInvestorApprovalEmail, sendInvestorRejectionEmail } from '@/server/notifications/email';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(2000).optional(),
});

type SideEffect =
  | { kind: 'APPROVED'; to: string; lang: 'en' | 'fr' | 'ar'; name: string }
  | { kind: 'REJECTED'; to: string; lang: 'en' | 'fr' | 'ar'; name: string; reason: string };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  if (input.status === 'REJECTED' && !input.reason?.trim()) {
    return jsonError(400, 'REASON_REQUIRED', 'A rejection reason is required');
  }

  let sideEffect: SideEffect | null = null;

  const result = await db.update((d) => {
    const user = (d.users ?? []).find((u) => u.id === id && u.role === 'INVESTOR');
    if (!user) return null;

    const now = new Date().toISOString();
    const email = user.email.trim();

    if (input.status === 'APPROVED') {
      user.investorStatus = 'APPROVED';
      user.investorRejectionReason = null;
      sideEffect = { kind: 'APPROVED', to: email, lang: user.locale, name: user.fullName };
    } else {
      user.investorStatus = 'REJECTED';
      user.investorRejectionReason = input.reason!.trim();
      sideEffect = { kind: 'REJECTED', to: email, lang: user.locale, name: user.fullName, reason: user.investorRejectionReason };
    }
    user.updatedAt = now;

    // Strip the password hash from the returned record.
    const { passwordHash: _ph, ...safe } = user;
    void _ph;
    return safe;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Investor not found');

  void appendAuditLog({
    adminId: guard.user.id, adminEmail: guard.user.email,
    action: input.status === 'APPROVED' ? 'INVESTOR_APPROVED' : 'INVESTOR_REJECTED',
    targetType: 'user', targetId: id,
    details: input.status === 'REJECTED' ? { reason: input.reason } : {},
  });

  if (sideEffect) {
    const fx = sideEffect as SideEffect;
    void (async () => {
      try {
        if (fx.kind === 'APPROVED') {
          await sendInvestorApprovalEmail({ to: fx.to, investorName: fx.name, lang: fx.lang });
        } else {
          await sendInvestorRejectionEmail({ to: fx.to, investorName: fx.name, reason: fx.reason, lang: fx.lang });
        }
      } catch (err) {
        console.error('[admin/investors] status email failed', err);
      }
    })();
  }

  return json(result);
}
