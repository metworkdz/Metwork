/**
 * POST /api/metworkcrm/auth/change-password
 *
 * Reachable while `mustChangePassword` is still set — it is the one action a
 * user in that state is allowed to take (`allowPasswordChangePending`).
 * Every OTHER session for the account is invalidated on success.
 */
import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { json, jsonError, fromZod } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { getCrmDb } from '@/server/metworkcrm/db/client';
import { internalUsers } from '@/server/metworkcrm/db/schema';
import { crmChangePasswordSchema } from '@/server/metworkcrm/auth/schemas';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import {
  currentCrmSessionHash,
  deleteAllCrmSessionsForUser,
} from '@/server/metworkcrm/auth/session';
import { crmErrorResponse } from '@/server/metworkcrm/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser({ allowPasswordChangePending: true });
  if (!guard.ok) return guard.response;
  const { user } = guard;

  if (!(await checkRateLimitDistributed(`crm:pwchange:${user.id}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Trop de tentatives. Réessayez dans quelques minutes.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Corps de requête invalide.');
  }

  const parsed = crmChangePasswordSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  // Same reasoning as the login route: any unexpected failure here (e.g. an
  // unreachable CRM database) must still return valid JSON, or the client's
  // `res.json()` throws and surfaces a misleading "network error".
  try {
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return jsonError(400, 'CRM_WRONG_PASSWORD', 'Mot de passe actuel incorrect.');
    }

    await getCrmDb()
      .update(internalUsers)
      .set({
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(internalUsers.id, user.id));

    // Any other device still holding the old credential is logged out; the
    // caller's own session survives so they are not bounced back to login.
    const keep = await currentCrmSessionHash();
    await deleteAllCrmSessionsForUser(user.id, { exceptIdHash: keep ?? undefined });

    return json({ ok: true, next: '/metworkcrm' });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
