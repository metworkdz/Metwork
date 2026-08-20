/**
 * METWORK OS CRM — route and API guards.
 *
 * The middleware CANNOT do this job: it runs on the Edge runtime, where neither
 * SQLite nor node:crypto is available. It only bypasses i18n for /metworkcrm
 * (R-4). ALL real authorization happens here, and every protected page and
 * route handler must call one of these.
 *
 * Dev rules R-19: guards apply to the route AND the API. A UI-only guard counts
 * as no guard at all.
 */
import { redirect } from 'next/navigation';
import { jsonError } from '@/server/http/json';
import { readCrmSession } from './session';
import type { InternalUser } from '../db/schema';
import type { NextResponse } from 'next/server';

export const CRM_LOGIN_PATH = '/metworkcrm/login';
export const CRM_CHANGE_PASSWORD_PATH = '/metworkcrm/change-password';
export const CRM_HOME_PATH = '/metworkcrm';

/** Modules an ADMIN may reach and a TEAM_MEMBER may not. */
export const ADMIN_ONLY_SEGMENTS = ['settings', 'users', 'payments'] as const;

/* ─────────────────────────── server components ─────────────────────────── */

/**
 * Require an authenticated CRM user in an RSC.
 *
 * Also enforces the forced-password-change gate: until `mustChangePassword` is
 * cleared, every page except the change-password screen itself redirects there.
 */
export async function requireCrmUser(
  opts: { allowPasswordChangePending?: boolean } = {},
): Promise<InternalUser> {
  const session = await readCrmSession();
  if (!session) redirect(CRM_LOGIN_PATH);

  if (session.user.mustChangePassword && !opts.allowPasswordChangePending) {
    redirect(CRM_CHANGE_PASSWORD_PATH);
  }

  return session.user;
}

/** Require an ADMIN in an RSC. TEAM_MEMBER is bounced to the dashboard. */
export async function requireCrmAdmin(): Promise<InternalUser> {
  const user = await requireCrmUser();
  if (user.role !== 'ADMIN') redirect(CRM_HOME_PATH);
  return user;
}

/* ─────────────────────────── route handlers ─────────────────────────── */

export type CrmApiGuard =
  | { ok: true; user: InternalUser }
  | { ok: false; response: NextResponse };

export async function requireCrmApiUser(
  opts: { allowPasswordChangePending?: boolean } = {},
): Promise<CrmApiGuard> {
  const session = await readCrmSession();
  if (!session) {
    return { ok: false, response: jsonError(401, 'CRM_UNAUTHENTICATED', 'Non authentifié.') };
  }
  if (session.user.mustChangePassword && !opts.allowPasswordChangePending) {
    return {
      ok: false,
      response: jsonError(
        403,
        'CRM_PASSWORD_CHANGE_REQUIRED',
        'Vous devez changer votre mot de passe avant de continuer.',
      ),
    };
  }
  return { ok: true, user: session.user };
}

export async function requireCrmApiAdmin(): Promise<CrmApiGuard> {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard;
  if (guard.user.role !== 'ADMIN') {
    return { ok: false, response: jsonError(403, 'CRM_FORBIDDEN', 'Accès réservé aux administrateurs.') };
  }
  return guard;
}

/* ─────────────────────────── money visibility ─────────────────────────── */

/**
 * Whether this user may see monetary figures ANYWHERE in the CRM.
 *
 * Dev rules R-19 (extended): TEAM_MEMBER is blocked from the Payments module
 * *and* from every amount elsewhere — dashboard pipeline value, Reports
 * revenue, opportunity amounts. Non-monetary metrics (stage counts, conversion
 * rates, overdue task counts) stay visible.
 *
 * Call this in the shared serialization layer, never per-route: a widget that
 * reads `crm_opportunities.amount` directly would otherwise sail past a guard
 * placed only on /metworkcrm/payments.
 */
export function canSeeMoney(user: Pick<InternalUser, 'role'>): boolean {
  return user.role === 'ADMIN';
}

/**
 * Strip monetary fields for users who may not see them. Returns the object
 * unchanged for ADMIN.
 */
export function redactMoney<T extends Record<string, unknown>>(
  user: Pick<InternalUser, 'role'>,
  row: T,
  moneyFields: readonly (keyof T)[],
): T {
  if (canSeeMoney(user)) return row;
  const copy = { ...row };
  for (const field of moneyFields) copy[field] = null as T[keyof T];
  return copy;
}
