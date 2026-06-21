/**
 * Consultant (mentor) self-service access — email → OTP + isolated session.
 *
 * Consultants have no platform user account, so this gives them a parallel,
 * minimal auth flow that NEVER resolves a `UserRecord`:
 *
 *   email → OTP  → verifyConsultantOtp → createMentorSession (cookie, 30-day TTL)
 *   first sign-in → setMentorPin (scrypt) + optional "remember this device"
 *   trusted device → verify PIN → createMentorSession (no OTP)
 *   each request → requireConsultant() resolves the mentorId from the cookie
 *
 * Mirrors the user `otp.ts` / `session.ts` mechanics: only the hash of the OTP
 * code / session id / device token is persisted; the plaintext lives only in
 * the email / the HttpOnly cookie. A DB leak can't hijack a session.
 */
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { db, type MentorRecord } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { issueOtp, verifyOtp, type OtpVerifyResult } from '@/server/auth/otp';
import type { NextResponse } from 'next/server';

/** Separate from the user session cookie (AUTH_COOKIE_NAME). */
export const CONSULTANT_COOKIE_NAME = 'metwork_consultant';
/** "Remember this device" cookie for the durable-token + PIN flow. */
export const CONSULTANT_DEVICE_COOKIE_NAME = 'metwork_consultant_device';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEVICE_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days ("remember this device")

/** Accepted PIN format: 4–6 digits. Enforced before hashing. */
const PIN_RE = /^\d{4,6}$/;
export function isValidPinFormat(pin: string): boolean {
  return PIN_RE.test(pin);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/* ─────────────────────────── Email OTP sign-in ─────────────────────────── */

/**
 * OTP key namespace. The user OTP table (`d.otps`) is keyed by an arbitrary
 * string; prefixing with `mentor:` reuses the exact issue/verify/lockout
 * machinery (`@/server/auth/otp`) without colliding with user-account OTPs.
 */
const OTP_KEY_PREFIX = 'mentor:';
/** Sentinel key used to equalize timing on the email-not-found branch. */
const OTP_KEY_NO_MATCH = `${OTP_KEY_PREFIX}__no_match__`;

/** Resolve the mentor record for an email (case-insensitive, trimmed), or null. */
export async function findMentorByEmail(email: string): Promise<MentorRecord | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  const data = await db.read();
  return (
    (data.mentors ?? []).find((m) => (m.email ?? '').trim().toLowerCase() === needle) ?? null
  );
}

export interface IssuedConsultantOtp {
  /** Plaintext 6-digit code — only ever returned to the issuer for delivery. */
  code: string;
  mentor: MentorRecord;
}

/**
 * Issue a sign-in OTP for the mentor with this email. Returns null when no
 * mentor matches — but ALWAYS performs an equivalent issuance (to a sentinel
 * key) first, so the matched / unmatched branches do the same work and cannot
 * be distinguished by timing. The caller still responds with a generic 200.
 */
export async function issueConsultantOtp(email: string): Promise<IssuedConsultantOtp | null> {
  const mentor = await findMentorByEmail(email);
  const { code } = await issueOtp(mentor ? OTP_KEY_PREFIX + mentor.id : OTP_KEY_NO_MATCH);
  if (!mentor) return null;
  return { code, mentor };
}

/** Verify a sign-in OTP for a mentor. Single-use, expiry- and attempt-checked. */
export async function verifyConsultantOtp(
  mentorId: string,
  code: string,
): Promise<OtpVerifyResult> {
  return verifyOtp(OTP_KEY_PREFIX + mentorId, code);
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
 * PIN + "remember this device"
 *
 * After an email → OTP sign-in, the consultant sets a PIN (scrypt-hashed,
 * reusing the user password util). On a trusted device a valid PIN restores the
 * session without another OTP. Everything is revocable: changing the PIN clears
 * all remembered devices; "forget this device" revokes a single one.
 * ════════════════════════════════════════════════════════════════════════ */

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

/**
 * Resolve the mentorId bound to a remembered-device token, or null. Used at the
 * `/mentordashboard` entry to decide whether a returning (session-less) browser
 * is a trusted device — and therefore which mentor's PIN-unlock screen to show.
 * Checks expiry and that the mentor still exists. Never reveals the PIN.
 */
export async function resolveMentorIdByDeviceToken(token: string): Promise<string | null> {
  if (!token) return null;
  const hash = sha256(token);
  const data = await db.read();
  const rec = (data.mentorDeviceTokens ?? []).find((t) => t.tokenHash === hash);
  if (!rec) return null;
  if (new Date(rec.expiresAt).getTime() <= Date.now()) return null;
  const mentor = (data.mentors ?? []).find((m) => m.id === rec.mentorId);
  return mentor ? mentor.id : null;
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
