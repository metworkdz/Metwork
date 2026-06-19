/**
 * Test-only OTP recovery for the e2e auth + guest-signup flows.
 *
 * The app NEVER stores or exposes a plaintext OTP: `issueOtp` /
 * `issuePendingUser` persist only `HMAC-SHA256(code, AUTH_SECRET)` and hand
 * the plaintext to the (mock) notifier, which just `console.log`s it. So a
 * Playwright `request`-context test can't "read its email".
 *
 * Instead we recover the code the same way an offline attacker who knows the
 * key would — except here the key is OURS: the e2e server runs with a known
 * `AUTH_SECRET` and `USE_LOCAL_DB=true`, flushing every write synchronously to
 * `.local-db.json`. We read that file, take the stored HMAC, and reverse it by
 * enumerating all 10^6 six-digit codes through the same HMAC. This touches ZERO
 * production code.
 *
 * The hash→code reverse index depends only on AUTH_SECRET (not on the DB), so
 * it's built once per worker (~1–1.5 s) and reused for every lookup.
 */
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Mirrors the server's local-DB path resolution (store.ts: localDbPath). */
function localDbPath(): string {
  return process.env.LOCAL_DB_PATH ?? '.local-db.json';
}

/**
 * The AUTH_SECRET the running server signs OTPs with. Prefer the process env
 * (set by the test runner / CI), else parse it out of `.env.local` so a plain
 * `npx playwright test` against a `.env.local`-configured dev server still works.
 */
function authSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const envFile = path.resolve('.env.local');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^\s*AUTH_SECRET\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1]!.replace(/^["']|["']$/g, '');
    }
  }
  throw new Error(
    '[otp] AUTH_SECRET not found — export it or set it in .env.local so the OTP can be recovered.',
  );
}

function hashCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/** Lazily-built reverse index: HMAC hex → 6-digit code. Keyed by secret. */
let reverseIndex: { secret: string; map: Map<string, string> } | null = null;

function reverse(): Map<string, string> {
  const secret = authSecret();
  if (reverseIndex && reverseIndex.secret === secret) return reverseIndex.map;
  const map = new Map<string, string>();
  for (let i = 0; i < 1_000_000; i++) {
    const code = String(i).padStart(6, '0');
    map.set(hashCode(code, secret), code);
  }
  reverseIndex = { secret, map };
  return map;
}

interface LocalDb {
  pendingUsers?: Array<{ id: string; email: string; phone: string; otpHash: string }>;
  otps?: Array<{ userId: string; codeHash: string; consumed: boolean }>;
}

function readDb(): LocalDb {
  const raw = fs.readFileSync(localDbPath(), 'utf8');
  return JSON.parse(raw) as LocalDb;
}

function recover(hash: string): string {
  const code = reverse().get(hash);
  if (!code) {
    throw new Error(
      `[otp] could not reverse OTP hash — AUTH_SECRET mismatch between the test runner and the server?`,
    );
  }
  return code;
}

/**
 * Recover the plaintext OTP for a PENDING signup, by the pending-user id that
 * `POST /api/auth/signup` returned as `userId`. This is the freshest code: a
 * `resend-otp` overwrites `otpHash`, so always read AFTER the last delivery.
 */
export function getSignupOtpByPendingId(pendingId: string): string {
  const db = readDb();
  const pending = (db.pendingUsers ?? []).find((p) => p.id === pendingId);
  if (!pending) throw new Error(`[otp] no pendingUser with id=${pendingId}`);
  return recover(pending.otpHash);
}

/** Recover the plaintext signup OTP by email (case-insensitive). */
export function getSignupOtpByEmail(email: string): string {
  const target = email.trim().toLowerCase();
  const db = readDb();
  const pending = (db.pendingUsers ?? []).find((p) => p.email.toLowerCase() === target);
  if (!pending) throw new Error(`[otp] no pendingUser with email=${email}`);
  return recover(pending.otpHash);
}

/**
 * Recover the plaintext OTP for an EXISTING user (legacy / resend-to-real-user
 * path) — the most recent unconsumed `otps` row for that userId.
 */
export function getUserOtp(userId: string): string {
  const db = readDb();
  const row = [...(db.otps ?? [])].reverse().find((o) => o.userId === userId && !o.consumed);
  if (!row) throw new Error(`[otp] no unconsumed otp for userId=${userId}`);
  return recover(row.codeHash);
}
