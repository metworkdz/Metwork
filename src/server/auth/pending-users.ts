/**
 * Pending-user lifecycle: signup → OTP verification → promotion.
 *
 * On signup we write to `pendingUsers` instead of `users` so that
 * duplicate-email/phone errors can never be triggered by an unverified
 * registration.  Only when the OTP is accepted do we atomically move the
 * record into the real `users` table.
 */
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { db, type PendingUserRecord, type UserRecord } from '@/server/db/store';
import { serverEnvVars } from '@/lib/env';
import type { UserRole } from '@/types/auth';

const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashOtp(code: string): string {
  return createHmac('sha256', serverEnvVars.AUTH_SECRET).update(code).digest('hex');
}

export interface PendingUserInput {
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  city: string;
  locale: 'en' | 'fr' | 'ar';
}

export interface IssuePendingResult {
  /** The pending record's id — returned to the client as `userId`. */
  id: string;
  /** Plaintext OTP — only used for SMS delivery, never stored. */
  otpCode: string;
}

/**
 * Create or overwrite a pending-user record and issue a fresh OTP.
 *
 * If a pending entry already exists for the same email or phone it is
 * silently replaced — this lets a user retry signup without being blocked
 * by their own previous attempt.  Expired pending records are swept on
 * every call.
 */
export async function issuePendingUser(input: PendingUserInput): Promise<IssuePendingResult> {
  const code = generateCode();
  const id = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();

  await db.update((d) => {
    // Remove any prior pending entry for the same email or phone.
    d.pendingUsers = d.pendingUsers.filter(
      (p) => p.email !== input.email && p.phone !== input.phone,
    );
    // Sweep expired records.
    const cutoff = Date.now();
    d.pendingUsers = d.pendingUsers.filter(
      (p) => new Date(p.expiresAt).getTime() > cutoff,
    );
    d.pendingUsers.push({
      id,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: input.role,
      city: input.city,
      locale: input.locale,
      otpHash: hashOtp(code),
      otpAttempts: 0,
      expiresAt,
      createdAt: now,
    });
  });

  return { id, otpCode: code };
}

export type VerifyPendingOtpResult =
  | { ok: true; pending: PendingUserRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INVALID' };

/**
 * Verify the OTP for a pending user.
 *
 * On success, returns a snapshot of the pending record.  The record is
 * NOT deleted here — call `promotePendingUser` next to atomically move it
 * into the real users table.
 */
export async function verifyPendingOtp(
  pendingId: string,
  code: string,
): Promise<VerifyPendingOtpResult> {
  const expected = hashOtp(code);

  return db.update<VerifyPendingOtpResult>((d) => {
    const pending = d.pendingUsers.find((p) => p.id === pendingId);
    if (!pending) return { ok: false, reason: 'NOT_FOUND' };
    if (new Date(pending.expiresAt).getTime() <= Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }
    if (pending.otpAttempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    }
    pending.otpAttempts += 1;
    if (pending.otpHash !== expected) {
      return { ok: false, reason: 'INVALID' };
    }
    // Return a snapshot; the caller handles promotion.
    return { ok: true, pending: { ...pending } };
  });
}

/**
 * Atomically move a verified pending user into the real `users` table and
 * remove the pending record.
 *
 * Returns the created UserRecord, or null if the pending record was already
 * gone (double-submit guard).
 */
export async function promotePendingUser(pendingId: string): Promise<UserRecord | null> {
  return db.update((d) => {
    const idx = d.pendingUsers.findIndex((p) => p.id === pendingId);
    if (idx === -1) return null;

    const pending = d.pendingUsers.splice(idx, 1)[0];
    if (!pending) return null;

    let role: UserRole = pending.role;
    // The first INCUBATOR to complete signup becomes the platform ADMIN.
    if (role === 'INCUBATOR' && !d.users.some((u) => u.role === 'INCUBATOR')) {
      role = 'ADMIN';
    }

    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      email: pending.email,
      passwordHash: pending.passwordHash,
      fullName: pending.fullName,
      phone: pending.phone,
      city: pending.city,
      role,
      status: 'ACTIVE',
      phoneVerified: true,
      emailVerified: false,
      membershipCode: null,
      avatarUrl: null,
      locale: pending.locale,
      createdAt: now,
      updatedAt: now,
    };
    d.users.push(user);
    return user;
  });
}

/**
 * Issue a fresh OTP for an existing pending user (resend path).
 *
 * Returns `{ code, phone, email }` so the caller can notify the user
 * without a second DB read, or `null` if the pending record no longer exists.
 */
export async function reissuePendingOtp(
  pendingId: string,
): Promise<{ code: string; phone: string; email: string } | null> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();

  return db.update<{ code: string; phone: string; email: string } | null>((d) => {
    const pending = d.pendingUsers.find((p) => p.id === pendingId);
    if (!pending) return null;
    pending.otpHash = hashOtp(code);
    pending.otpAttempts = 0;
    pending.expiresAt = expiresAt;
    return { code, phone: pending.phone, email: pending.email };
  });
}
