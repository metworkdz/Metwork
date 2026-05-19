/**
 * PATCH /api/admin/incubators/:id  — update an incubator (admin only)
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendIncubatorApprovalEmail } from '@/server/notifications/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:             z.string().min(2).max(120).optional(),
  email:            z.string().email().max(200).optional(),
  phone:            z.string().min(6).max(30).optional(),
  city:             z.string().min(1).max(80).optional(),
  status:           z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  subscriptionCode: z.enum(['COMMISSION', 'FLAT']).optional(),
});

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

  // Capture pre-mutation state so we can detect the PENDING → ACTIVE
  // transition and trigger the side effects (approval email, owner reactivation)
  // outside the write critical section.
  let approvalSideEffects: {
    ownerEmail: string;
    ownerLocale: 'en' | 'fr' | 'ar';
    incubatorName: string;
  } | null = null;

  const result = await db.update((d) => {
    if (!Array.isArray(d.incubators)) d.incubators = [];
    const inc = d.incubators.find((x) => x.id === id);
    if (!inc) return null;

    const prevStatus = inc.status;

    if (input.name !== undefined)             inc.name             = input.name.trim();
    if (input.email !== undefined)            inc.email            = input.email.trim();
    if (input.phone !== undefined)            inc.phone            = input.phone.trim();
    if (input.city !== undefined)             inc.city             = input.city.trim();
    if (input.status !== undefined)           inc.status           = input.status;
    if (input.subscriptionCode !== undefined) inc.subscriptionCode = input.subscriptionCode;
    inc.updatedAt = new Date().toISOString();

    // Detect the approval transition: PENDING → ACTIVE.
    // On approval we (a) flip the owner user's status to ACTIVE if it
    // was suspended/inactive, and (b) capture data so the route can send
    // the approval email after the write completes.
    if (
      input.status === 'ACTIVE' &&
      prevStatus === 'PENDING' &&
      inc.managerId
    ) {
      const owner = d.users.find((u) => u.id === inc.managerId);
      if (owner) {
        if (owner.status !== 'ACTIVE') {
          owner.status = 'ACTIVE';
          owner.updatedAt = inc.updatedAt;
        }
        const email = (inc.email ?? owner.email)?.trim();
        if (email) {
          approvalSideEffects = {
            ownerEmail: email,
            ownerLocale: owner.locale,
            incubatorName: inc.name,
          };
        }
      }
    }

    return inc;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Incubator not found');

  // Fire-and-forget: approval email must never block or fail the API response.
  if (approvalSideEffects) {
    // re-bind to satisfy the narrowing of `approvalSideEffects` inside the IIFE
    const side = approvalSideEffects as {
      ownerEmail: string;
      ownerLocale: 'en' | 'fr' | 'ar';
      incubatorName: string;
    };
    void (async () => {
      try {
        await sendIncubatorApprovalEmail({
          to: side.ownerEmail,
          incubatorName: side.incubatorName,
          // Arabic users still receive the FR template (closest fit) — the
          // template only ships EN and FR per spec.
          lang: side.ownerLocale === 'en' ? 'en' : 'fr',
        });
      } catch (err) {
        console.error('[admin/incubators] approval email failed', err);
      }
    })();
  }

  return json(result);
}
