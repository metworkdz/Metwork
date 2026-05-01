/**
 * Server-side session management.
 *
 * - Session IDs are 256 bits of random, base64url-encoded.
 * - Only the SHA-256 hash is stored server-side; the plaintext ID lives
 *   solely in the HttpOnly cookie. A DB leak therefore does not let an
 *   attacker hijack live sessions.
 * - Cookies are HttpOnly + SameSite=Lax; Secure flag in production.
 */
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { db, type SessionRecord, type UserRecord } from '@/server/db/store';
import { serverEnvVars } from '@/lib/env';

const DEFAULT_TTL_DAYS = 7;
const REMEMBER_TTL_DAYS = 30;

function ttlMs(remember: boolean): number {
  const days = remember ? REMEMBER_TTL_DAYS : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export interface IssuedSession {
  /** Plaintext session ID — set this in the cookie. Never persisted. */
  id: string;
  expiresAt: string;
}

export async function createSession(
  userId: string,
  opts: { remember?: boolean } = {},
): Promise<IssuedSession> {
  const id = randomBytes(32).toString('base64url');
  const idHash = hashId(id);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs(opts.remember ?? false)).toISOString();
  const record: SessionRecord = {
    idHash,
    userId,
    expiresAt,
    createdAt: new Date(now).toISOString(),
  };
  await db.update((d) => {
    d.sessions.push(record);
  });
  return { id, expiresAt };
}

export async function setSessionCookie(issued: IssuedSession): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(
    0,
    Math.floor((new Date(issued.expiresAt).getTime() - Date.now()) / 1000),
  );
  store.set(serverEnvVars.AUTH_COOKIE_NAME, issued.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(serverEnvVars.AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export interface ResolvedSession {
  user: UserRecord;
  session: SessionRecord;
}

export async function readSession(): Promise<ResolvedSession | null> {
  const store = await cookies();
  const sessionId = store.get(serverEnvVars.AUTH_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const idHash = hashId(sessionId);
  const data = await db.read();
  const session = data.sessions.find((s) => s.idHash === idHash);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSessionByHash(idHash);
    return null;
  }

  const user = data.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { user, session };
}

async function deleteSessionByHash(idHash: string): Promise<void> {
  await db.update((d) => {
    d.sessions = d.sessions.filter((s) => s.idHash !== idHash);
  });
}

export async function deleteCurrentSession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(serverEnvVars.AUTH_COOKIE_NAME)?.value;
  if (!sessionId) return;
  await deleteSessionByHash(hashId(sessionId));
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.update((d) => {
    d.sessions = d.sessions.filter((s) => s.userId !== userId);
  });
}
