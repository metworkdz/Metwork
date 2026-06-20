/**
 * PATCH /api/admin/incubators/:id  — update an incubator (admin only)
 *
 * Handles the approval lifecycle:
 *   PENDING → ACTIVE   ⇒ approval email (incubator locale, default fr) + owner reactivation
 *   * → REJECTED       ⇒ rejection email with admin reason (incubator locale, default fr)
 *
 * All external (email) calls are fire-and-forget — they never block or fail
 * the API response.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendIncubatorApprovalEmail, sendIncubatorRejectionEmail } from '@/server/notifications/email';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:             z.string().min(2).max(120).optional(),
  email:            z.string().email().max(200).optional(),
  phone:            z.string().min(6).max(30).optional(),
  city:             z.string().min(1).max(80).optional(),
  website:          z.string().max(200).optional(),
  instagram:        z.string().max(200).optional(),
  status:           z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
  /** Free-text reason — required (validated below) when status === 'REJECTED'. */
  rejectionReason:  z.string().max(2000).optional(),
  subscriptionCode: z.enum(['COMMISSION', 'FLAT']).optional(),
});

type SideEffect =
  | { kind: 'APPROVED'; to: string; lang: 'en' | 'fr' | 'ar'; incubatorName: string }
  | { kind: 'REJECTED'; to: string; lang: 'en' | 'fr' | 'ar'; incubatorName: string; reason: string };

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

  if (input.status === 'REJECTED' && !input.rejectionReason?.trim()) {
    return jsonError(400, 'REASON_REQUIRED', 'A rejection reason is required');
  }

  // Side effects (emails) captured inside the write critical section, fired after.
  let sideEffect: SideEffect | null = null;

  const result = await db.update((d) => {
    if (!Array.isArray(d.incubators)) d.incubators = [];
    const inc = d.incubators.find((x) => x.id === id);
    if (!inc) return null;

    const prevStatus = inc.status;

    if (input.name !== undefined)             inc.name             = input.name.trim();
    if (input.email !== undefined)            inc.email            = input.email.trim();
    if (input.phone !== undefined)            inc.phone            = input.phone.trim();
    if (input.city !== undefined)             inc.city             = input.city.trim();
    if (input.website !== undefined)          inc.website          = input.website.trim() || null;
    if (input.instagram !== undefined)        inc.instagram        = input.instagram.trim() || null;
    if (input.status !== undefined)           inc.status           = input.status;
    if (input.subscriptionCode !== undefined) inc.subscriptionCode = input.subscriptionCode;
    inc.updatedAt = new Date().toISOString();

    const owner = inc.managerId ? d.users.find((u) => u.id === inc.managerId) : undefined;
    const ownerLang = owner?.locale ?? 'fr';
    const contactEmail = (inc.email ?? owner?.email)?.trim();

    // Approval transition: PENDING → ACTIVE, or re-approval REJECTED → ACTIVE.
    if (input.status === 'ACTIVE' && (prevStatus === 'PENDING' || prevStatus === 'REJECTED')) {
      inc.rejectionReason = null;
      if (owner && owner.status !== 'ACTIVE') {
        owner.status = 'ACTIVE';
        owner.updatedAt = inc.updatedAt;
      }
      if (contactEmail) {
        sideEffect = { kind: 'APPROVED', to: contactEmail, lang: ownerLang, incubatorName: inc.name };
      }
    }

    // Rejection transition: * → REJECTED.
    if (input.status === 'REJECTED' && prevStatus !== 'REJECTED') {
      inc.rejectionReason = input.rejectionReason!.trim();
      if (contactEmail) {
        sideEffect = {
          kind: 'REJECTED',
          to: contactEmail,
          lang: ownerLang,
          incubatorName: inc.name,
          reason: inc.rejectionReason,
        };
      }
    }

    return inc;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Incubator not found');

  // Audit (fire-and-forget) for status transitions.
  if (input.status === 'ACTIVE') {
    void appendAuditLog({
      adminId: guard.user.id, adminEmail: guard.user.email,
      action: 'INCUBATOR_APPROVED', targetType: 'incubator', targetId: id, details: {},
    });
  } else if (input.status === 'REJECTED') {
    void appendAuditLog({
      adminId: guard.user.id, adminEmail: guard.user.email,
      action: 'INCUBATOR_REJECTED', targetType: 'incubator', targetId: id,
      details: { reason: input.rejectionReason },
    });
  }

  // Fire-and-forget: emails must never block or fail the API response.
  if (sideEffect) {
    const fx = sideEffect as SideEffect;
    void (async () => {
      try {
        if (fx.kind === 'APPROVED') {
          await sendIncubatorApprovalEmail({ to: fx.to, incubatorName: fx.incubatorName, lang: fx.lang });
        } else {
          await sendIncubatorRejectionEmail({ to: fx.to, incubatorName: fx.incubatorName, reason: fx.reason, lang: fx.lang });
        }
      } catch (err) {
        console.error('[admin/incubators] status email failed', err);
      }
    })();
  }

  return json(result);
}
