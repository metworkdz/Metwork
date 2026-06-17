/**
 * Consultant (mentor) self-service access — magic link + isolated session.
 *
 * Consultants have no platform user account, so this gives them a parallel,
 * minimal auth flow that NEVER resolves a `UserRecord`:
 *
 *   request link → issueMentorMagicLink (single-use, hashed, 30-min TTL, emailed)
 *   click link   → consumeMentorMagicLink → createMentorSession (cookie, 30-day TTL)
 *   each request → requireConsultant() resolves the mentorId from the cookie
 *
 * Mirrors the user `email-verification.ts` / `session.ts` mechanics: only the
 * SHA-256 hash of the token / session id is persisted; the plaintext lives only
 * in the email link / the HttpOnly cookie. A DB leak can't hijack a session.
 */
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { db, type MentorRecord } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import type { NextResponse } from 'next/server';

/** Separate from the user session cookie (AUTH_COOKIE_NAME). */
export const CONSULTANT_COOKIE_NAME = 'metwork_consultant';

const MAGIC_LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/* ─────────────────────────── Magic link ─────────────────────────── */

export interface IssuedMagicLink {
  /** Plaintext token — embed in the email link. Never persisted. */
  token: string;
  mentor: MentorRecord;
}

/**
 * Issue a single-use magic-link token for the mentor with this email. Returns
 * null when no mentor matches (the caller still responds 200 to avoid email
 * enumeration). Invalidates any prior unconsumed tokens for the mentor.
 */
export async function issueMentorMagicLink(email: string): Promise<IssuedMagicLink | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;

  const data = await db.read();
  const mentor = (data.mentors ?? []).find(
    (m) => (m.email ?? '').trim().toLowerCase() === needle,
  );
  if (!mentor) return null;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();
  await db.update((d) => {
    if (!Array.isArray(d.mentorAccessTokens)) d.mentorAccessTokens = [];
    d.mentorAccessTokens = d.mentorAccessTokens.filter(
      (t) => t.mentorId !== mentor.id || t.consumed,
    );
    d.mentorAccessTokens.push({ tokenHash: sha256(token), mentorId: mentor.id, expiresAt, consumed: false });
  });
  return { token, mentor };
}

export type ConsumeMagicLinkResult =
  | { ok: true; mentorId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' };

/** Validate + consume a magic-link token. Single-use. */
export async function consumeMentorMagicLink(token: string): Promise<ConsumeMagicLinkResult> {
  const tokenHash = sha256(token);
  return db.update<ConsumeMagicLinkResult>((d) => {
    const rec = (d.mentorAccessTokens ?? []).find((t) => t.tokenHash === tokenHash);
    if (!rec) return { ok: false, reason: 'NOT_FOUND' };
    if (rec.consumed) return { ok: false, reason: 'CONSUMED' };
    if (new Date(rec.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED' };
    rec.consumed = true;
    return { ok: true, mentorId: rec.mentorId };
  });
}

/* ─────────────────────────── Session ─────────────────────────── */

export interface IssuedConsultantSession {
  /** Plaintext session id — set this in the cookie. Never persisted. */
  id: string;
  expiresAt: string;
}

export async function createMentorSession(mentorId: string): Promise<IssuedConsultantSession> {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  await db.update((d) => {
    if (!Array.isArray(d.mentorSessions)) d.mentorSessions = [];
    d.mentorSessions.push({
      idHash: sha256(id),
      mentorId,
      expiresAt,
      createdAt: new Date(now).toISOString(),
    });
  });
  return { id, expiresAt };
}

export async function setMentorSessionCookie(issued: IssuedConsultantSession): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(0, Math.floor((new Date(issued.expiresAt).getTime() - Date.now()) / 1000));
  store.set(CONSULTANT_COOKIE_NAME, issued.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export async function clearMentorSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(CONSULTANT_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Resolve the consultant's mentorId from the session cookie, or null. */
export async function readMentorSession(): Promise<string | null> {
  const store = await cookies();
  const sessionId = store.get(CONSULTANT_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const idHash = sha256(sessionId);
  const data = await db.read();
  const session = (data.mentorSessions ?? []).find((s) => s.idHash === idHash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await db.update((d) => {
      d.mentorSessions = (d.mentorSessions ?? []).filter((s) => s.idHash !== idHash);
    });
    return null;
  }
  // The mentor must still exist.
  const mentor = (data.mentors ?? []).find((m) => m.id === session.mentorId);
  return mentor ? mentor.id : null;
}

export async function deleteCurrentMentorSession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(CONSULTANT_COOKIE_NAME)?.value;
  if (!sessionId) return;
  const idHash = sha256(sessionId);
  await db.update((d) => {
    d.mentorSessions = (d.mentorSessions ?? []).filter((s) => s.idHash !== idHash);
  });
}

/* ─────────────────────────── API guard ─────────────────────────── */

export type ConsultantGuardResult =
  | { ok: true; mentorId: string }
  | { ok: false; response: NextResponse };

/** Use inside consultant API routes: `const g = await requireConsultant(); if (!g.ok) return g.response;` */
export async function requireConsultant(): Promise<ConsultantGuardResult> {
  const mentorId = await readMentorSession();
  if (!mentorId) {
    return { ok: false, response: jsonError(401, 'UNAUTHENTICATED', 'Consultant session required') };
  }
  return { ok: true, mentorId };
}
