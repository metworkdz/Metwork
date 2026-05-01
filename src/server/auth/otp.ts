/**
 * One-time password (OTP) issuance and verification.
 *
 * Codes are 6 numeric digits. Only the HMAC-SHA256 of the code (keyed
 * by AUTH_SECRET) is persisted, so a DB leak does not let an attacker
 * brute-force codes offline. Each verification increments an attempt
 * counter; the record is locked after MAX_ATTEMPTS regardless of outcome.
 */
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { db } from '@/server/db/store';
import { serverEnvVars } from '@/lib/env';

const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHmac('sha256', serverEnvVars.AUTH_SECRET).update(code).digest('hex');
}

function generateCode(): string {
  // 6 digits, leading zeros allowed → range [0, 1_000_000)
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface OtpIssue {
  /** Plaintext code — only ever returned to the issuer for delivery. */
  code: string;
  expiresAt: string;
}

export async function issueOtp(userId: string): Promise<OtpIssue> {
  const code = generateCode();
  const id = randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();
  await db.update((d) => {
    // Invalidate any prior unconsumed OTPs for this user.
    d.otps = d.otps.filter((o) => o.userId !== userId || o.consumed);
    d.otps.push({
      id,
      userId,
      codeHash: hashCode(code),
      expiresAt,
      attempts: 0,
      consumed: false,
    });
  });
  return { code, expiresAt };
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INVALID' };

export async function verifyOtp(userId: string, code: string): Promise<OtpVerifyResult> {
  const expected = hashCode(code);
  return db.update<OtpVerifyResult>((d) => {
    const otp = [...d.otps].reverse().find((o) => o.userId === userId && !o.consumed);
    if (!otp) return { ok: false, reason: 'NOT_FOUND' };
    if (new Date(otp.expiresAt).getTime() <= Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    }
    otp.attempts += 1;
    if (otp.codeHash !== expected) {
      return { ok: false, reason: 'INVALID' };
    }
    otp.consumed = true;
    return { ok: true };
  });
}
