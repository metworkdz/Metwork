/**
 * METWORK OS CRM — session management.
 *
 * A FOURTH, fully isolated identity space. The platform already runs three
 * (customer `metwork_session`, consultant `metwork_consultant`, consultant
 * device `metwork_consultant_device`); this adds internal staff. The same email
 * may exist in several of them with no relationship whatsoever.
 *
 * Mechanics mirror `@/server/auth/session.ts` deliberately:
 *   - 256 bits of randomness, base64url
 *   - only the SHA-256 hash is persisted; the plaintext lives solely in the
 *     cookie, so a database leak cannot hijack a live session
 *   - HttpOnly + Secure in production
 *
 * SameSite is `strict` (schema doc §1, dev rules R-17), unlike the platform's
 * `lax`. The platform needs `lax` because its login is a form POST that 302s;
 * the CRM logs in via fetch + client-side navigation, which is same-site and
 * unaffected. Known trade-off: following an EXTERNAL link straight into
 * /metworkcrm renders the first paint logged-out until any in-app navigation.
 */
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmSessions, internalUsers, type InternalUser } from '../db/schema';

export const CRM_COOKIE_NAME = 'metwork_crm';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export interface IssuedCrmSession {
  /** Plaintext id — goes in the cookie. NEVER persisted. */
  id: string;
  expiresAt: string;
}

export async function createCrmSession(
  userId: string,
  opts: { userAgent?: string | null } = {},
): Promise<IssuedCrmSession> {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

  await getCrmDb().insert(crmSessions).values({
    idHash: hashId(id),
    userId,
    expiresAt,
    createdAt: new Date(now).toISOString(),
    userAgent: opts.userAgent ?? null,
  });

  return { id, expiresAt };
}

export async function setCrmSessionCookie(issued: IssuedCrmSession): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(
    0,
    Math.floor((new Date(issued.expiresAt).getTime() - Date.now()) / 1000),
  );
  store.set(CRM_COOKIE_NAME, issued.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

export async function clearCrmSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(CRM_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

export interface ResolvedCrmSession {
  user: InternalUser;
  expiresAt: string;
}

/**
 * Resolve the current CRM session, or null. Expired rows are deleted on sight.
 * Deactivated accounts resolve to null so `is_active = 0` logs someone out
 * everywhere without deleting their audit trail.
 */
export async function readCrmSession(): Promise<ResolvedCrmSession | null> {
  const store = await cookies();
  const sessionId = store.get(CRM_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const db = getCrmDb();
  const idHash = hashId(sessionId);

  const rows = await db
    .select({ session: crmSessions, user: internalUsers })
    .from(crmSessions)
    .innerJoin(internalUsers, eq(crmSessions.userId, internalUsers.id))
    .where(eq(crmSessions.idHash, idHash));

  const row = rows[0];
  if (!row) return null;

  if (new Date(row.session.expiresAt).getTime() <= Date.now()) {
    await db.delete(crmSessions).where(eq(crmSessions.idHash, idHash));
    return null;
  }

  if (!row.user.isActive) return null;

  return { user: row.user, expiresAt: row.session.expiresAt };
}

export async function deleteCurrentCrmSession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(CRM_COOKIE_NAME)?.value;
  if (!sessionId) return;
  await getCrmDb().delete(crmSessions).where(eq(crmSessions.idHash, hashId(sessionId)));
}

/**
 * Invalidate every session for a user — used after a password change so any
 * other device holding the old credential is logged out. `exceptIdHash` keeps
 * the caller's own session alive.
 */
export async function deleteAllCrmSessionsForUser(
  userId: string,
  opts: { exceptIdHash?: string } = {},
): Promise<void> {
  await getCrmDb()
    .delete(crmSessions)
    .where(
      opts.exceptIdHash
        ? and(eq(crmSessions.userId, userId), ne(crmSessions.idHash, opts.exceptIdHash))
        : eq(crmSessions.userId, userId),
    );
}

/** Hash of the session id currently in the cookie, if any. */
export async function currentCrmSessionHash(): Promise<string | null> {
  const store = await cookies();
  const sessionId = store.get(CRM_COOKIE_NAME)?.value;
  return sessionId ? hashId(sessionId) : null;
}
