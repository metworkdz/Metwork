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
import { hashPassword, verifyPassword } from '@/server/auth/password';
import type { NextResponse } from 'next/server';

/** Separate from the user session cookie (AUTH_COOKIE_NAME). */
export const CONSULTANT_COOKIE_NAME = 'metwork_consultant';
/** "Remember this device" cookie for the durable-token + PIN flow. */
export const CONSULTANT_DEVICE_COOKIE_NAME = 'metwork_consultant_device';

const MAGIC_LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Accepted PIN format: 4–6 digits. Enforced before hashing. */
const PIN_RE = /^\d{4,6}$/;
export function isValidPinFormat(pin: string): boolean {
  return PIN_RE.test(pin);
}

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

/* ════════════════════════════════════════════════════════════════════════
 * Durable per-mentor access token + PIN + "remember this device"
 *
 * Parallel access path to the email magic-link above (which stays as a
 * fallback). The admin generates a long, unguessable token whose SHA-256 hash
 * is stored on the MentorRecord; the plaintext link is shared out-of-band. On
 * first use the consultant sets a PIN (scrypt-hashed, reusing the user
 * password util). Viewing client PII requires a valid PIN or a valid
 * "remember this device" token. Everything is revocable: rotating the access
 * token or changing the PIN clears all device tokens.
 * ════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── Access token ─────────────────────────── */

export interface GeneratedAccessToken {
  /** Plaintext token — embed in the link shown ONCE to the admin. Never persisted. */
  token: string;
  mentor: MentorRecord;
}

/**
 * (Re)generate the durable access token for a mentor. Stores only the hash and
 * stamps `accessTokenRotatedAt`. Rotation invalidates the previous link AND all
 * remembered devices (security: a rotate is also the "something's wrong" lever).
 * The PIN is preserved. Returns null when the mentor doesn't exist.
 */
export async function generateMentorAccessToken(
  mentorId: string,
): Promise<GeneratedAccessToken | null> {
  const token = randomBytes(48).toString('base64url');
  const now = new Date().toISOString();
  return db.update<GeneratedAccessToken | null>((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === mentorId);
    if (!mentor) return null;
    mentor.accessTokenHash = sha256(token);
    mentor.accessTokenRotatedAt = now;
    // Rotation revokes remembered devices for this mentor.
    d.mentorDeviceTokens = (d.mentorDeviceTokens ?? []).filter((t) => t.mentorId !== mentorId);
    return { token, mentor };
  });
}

/**
 * Revoke durable-token access entirely: clears the token hash and all remembered
 * devices. The PIN hash is left in place (harmless without a token; restored if
 * the admin later re-issues a token). Returns false when the mentor doesn't exist.
 */
export async function revokeMentorAccessToken(mentorId: string): Promise<boolean> {
  return db.update<boolean>((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === mentorId);
    if (!mentor) return false;
    mentor.accessTokenHash = null;
    mentor.accessTokenRotatedAt = null;
    d.mentorDeviceTokens = (d.mentorDeviceTokens ?? []).filter((t) => t.mentorId !== mentorId);
    return true;
  });
}

/** Resolve a mentorId from a raw durable access token, or null. Does NOT check PIN/device. */
export async function resolveMentorIdByAccessToken(token: string): Promise<string | null> {
  if (!token) return null;
  const hash = sha256(token);
  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.accessTokenHash && m.accessTokenHash === hash);
  return mentor ? mentor.id : null;
}

/* ─────────────────────────── PIN ─────────────────────────── */

export type SetPinResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_SET' | 'INVALID_FORMAT' };

/** True once the mentor has a PIN set. */
export async function mentorHasPin(mentorId: string): Promise<boolean> {
  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === mentorId);
  return Boolean(mentor?.pinHash);
}

/**
 * Set the PIN on first access. Fails if a PIN already exists (use
 * `changeMentorPin` to rotate). The PIN is scrypt-hashed via the user util.
 */
export async function setMentorPin(mentorId: string, pin: string): Promise<SetPinResult> {
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'INVALID_FORMAT' };
  const data = await db.read();
  const existing = (data.mentors ?? []).find((m) => m.id === mentorId);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  if (existing.pinHash) return { ok: false, reason: 'ALREADY_SET' };
  const pinHash = await hashPassword(pin);
  const now = new Date().toISOString();
  return db.update<SetPinResult>((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === mentorId);
    if (!mentor) return { ok: false, reason: 'NOT_FOUND' };
    if (mentor.pinHash) return { ok: false, reason: 'ALREADY_SET' };
    mentor.pinHash = pinHash;
    mentor.pinSetAt = now;
    return { ok: true };
  });
}

export type ChangePinResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'NO_PIN' | 'WRONG_PIN' | 'INVALID_FORMAT' };

/**
 * Change the PIN. Requires the current PIN. Rotating the PIN revokes all
 * remembered devices (a new PIN means re-trusting devices). The consultant can
 * call this any time from their account.
 */
export async function changeMentorPin(
  mentorId: string,
  currentPin: string,
  newPin: string,
): Promise<ChangePinResult> {
  if (!isValidPinFormat(newPin)) return { ok: false, reason: 'INVALID_FORMAT' };
  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === mentorId);
  if (!mentor) return { ok: false, reason: 'NOT_FOUND' };
  if (!mentor.pinHash) return { ok: false, reason: 'NO_PIN' };
  if (!(await verifyPassword(currentPin, mentor.pinHash))) return { ok: false, reason: 'WRONG_PIN' };
  const newHash = await hashPassword(newPin);
  const now = new Date().toISOString();
  return db.update<ChangePinResult>((d) => {
    const m = (d.mentors ?? []).find((x) => x.id === mentorId);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    m.pinHash = newHash;
    m.pinSetAt = now;
    d.mentorDeviceTokens = (d.mentorDeviceTokens ?? []).filter((t) => t.mentorId !== mentorId);
    return { ok: true };
  });
}

/** Verify a PIN against the mentor's stored hash. Pure check — rate-limit at the route. */
export async function verifyMentorPin(mentorId: string, pin: string): Promise<boolean> {
  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === mentorId);
  if (!mentor?.pinHash) return false;
  return verifyPassword(pin, mentor.pinHash);
}

/* ─────────────────────── "Remember this device" ─────────────────────── */

export interface IssuedDeviceToken {
  /** Plaintext device token — set in the device cookie. Never persisted. */
  token: string;
  expiresAt: string;
}

/** Issue a remembered-device token for a mentor. Only the hash is stored. */
export async function issueMentorDeviceToken(
  mentorId: string,
  label?: string | null,
): Promise<IssuedDeviceToken> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + DEVICE_TOKEN_TTL_MS).toISOString();
  await db.update((d) => {
    if (!Array.isArray(d.mentorDeviceTokens)) d.mentorDeviceTokens = [];
    d.mentorDeviceTokens.push({
      tokenHash: sha256(token),
      mentorId,
      expiresAt,
      createdAt: new Date(now).toISOString(),
      label: label?.slice(0, 120) ?? null,
    });
  });
  return { token, expiresAt };
}

/** True when `token` is a live remembered-device token for `mentorId`. */
export async function validateMentorDeviceToken(mentorId: string, token: string): Promise<boolean> {
  if (!token) return false;
  const hash = sha256(token);
  const data = await db.read();
  const rec = (data.mentorDeviceTokens ?? []).find(
    (t) => t.tokenHash === hash && t.mentorId === mentorId,
  );
  if (!rec) return false;
  if (new Date(rec.expiresAt).getTime() <= Date.now()) {
    await db.update((d) => {
      d.mentorDeviceTokens = (d.mentorDeviceTokens ?? []).filter((t) => t.tokenHash !== hash);
    });
    return false;
  }
  return true;
}

/** Revoke a single remembered-device token (e.g. "forget this device"). */
export async function revokeMentorDeviceToken(token: string): Promise<void> {
  if (!token) return;
  const hash = sha256(token);
  await db.update((d) => {
    d.mentorDeviceTokens = (d.mentorDeviceTokens ?? []).filter((t) => t.tokenHash !== hash);
  });
}

export async function setMentorDeviceCookie(issued: IssuedDeviceToken): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(0, Math.floor((new Date(issued.expiresAt).getTime() - Date.now()) / 1000));
  store.set(CONSULTANT_DEVICE_COOKIE_NAME, issued.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export async function readMentorDeviceCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(CONSULTANT_DEVICE_COOKIE_NAME)?.value ?? null;
}

export async function clearMentorDeviceCookie(): Promise<void> {
  const store = await cookies();
  store.set(CONSULTANT_DEVICE_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/* ─────────────────────── Combined validator ─────────────────────── */

/**
 * The single entry point required by PROMPT 2 §2.
 *
 * Resolves a mentorId from a durable access token AND a passing credential
 * (a valid remembered-device token OR a correct PIN). Returns the mentorId on
 * success, or null on any failure (unknown/expired token, no PIN set, wrong
 * PIN, bad device token). This is the gate for viewing client PII.
 *
 * NOTE: this performs no rate-limiting itself — callers (the PIN route) wrap it
 * with `checkRateLimitDistributed` keyed by mentor + client IP.
 */
export async function validateMentorAccess(
  token: string,
  credential: { pin?: string; deviceToken?: string },
): Promise<string | null> {
  const mentorId = await resolveMentorIdByAccessToken(token);
  if (!mentorId) return null;

  if (credential.deviceToken && (await validateMentorDeviceToken(mentorId, credential.deviceToken))) {
    return mentorId;
  }
  if (credential.pin && (await verifyMentorPin(mentorId, credential.pin))) {
    return mentorId;
  }
  return null;
}
