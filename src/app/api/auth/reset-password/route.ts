/**
 * POST /api/auth/reset-password
 *
 * Consumes a single-use password-reset token and updates the user's password.
 * Returns 200 on success so the client can show a confirmation and redirect
 * to login, or a structured error if the token is invalid/expired/consumed.
 *
 * Security notes:
 *  - Token is SHA-256 hashed on arrival before comparing to the stored hash.
 *  - Token is marked consumed atomically before the password is written, so a
 *    race-condition attacker cannot replay the same token twice.
 *  - Generic error messages avoid leaking token validity information.
 */
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { resetPasswordRequestSchema } from '@/server/auth/schemas';
import { db } from '@/server/db/store';
import { hashPassword } from '@/server/auth/password';
import { deleteAllSessionsForUser } from '@/server/auth/session';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = resetPasswordRequestSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const tokenHash = hashToken(input.token);

  // Validate the token before the slow hash operation.
  const preCheck = await db.update((d) => {
    const idx = d.passwordResets.findIndex(
      (r) => r.tokenHash === tokenHash && !r.consumed,
    );
    if (idx === -1) return { ok: false, reason: 'INVALID_TOKEN' as const };

    const record = d.passwordResets[idx]!;
    if (new Date(record.expiresAt) < new Date()) {
      return { ok: false, reason: 'TOKEN_EXPIRED' as const };
    }
    return { ok: true, userId: record.userId };
  });

  if (!preCheck.ok) {
    // Both INVALID_TOKEN and TOKEN_EXPIRED return the same 400 to clients
    // so attackers can't distinguish between the two states.
    return jsonError(
      400,
      'INVALID_OR_EXPIRED_TOKEN',
      'This reset link is invalid or has expired. Please request a new one.',
    );
  }

  // Compute the hash outside the db lock (scrypt is slow — ~200 ms).
  const newHash = await hashPassword(input.password);

  type AtomicResult =
    | { ok: true; userId: string }
    | { ok: false; reason: 'INVALID_TOKEN' | 'TOKEN_EXPIRED' };

  // Atomically mark the token consumed AND write the new password hash in a
  // single db.update so the two operations cannot be split by a concurrent
  // request (FIX 5: L-03).
  const result = await db.update<AtomicResult>((d) => {
    const idx = d.passwordResets.findIndex(
      (r) => r.tokenHash === tokenHash && !r.consumed,
    );
    if (idx === -1) return { ok: false, reason: 'INVALID_TOKEN' as const };

    const record = d.passwordResets[idx]!;
    if (new Date(record.expiresAt) < new Date()) {
      return { ok: false, reason: 'TOKEN_EXPIRED' as const };
    }

    // Mark consumed and update password atomically.
    d.passwordResets[idx] = { ...record, consumed: true };
    const user = d.users.find((u) => u.id === record.userId);
    if (user) {
      user.passwordHash = newHash;
      user.updatedAt = new Date().toISOString();
    }
    return { ok: true, userId: record.userId };
  });

  if (!result.ok) {
    return jsonError(
      400,
      'INVALID_OR_EXPIRED_TOKEN',
      'This reset link is invalid or has expired. Please request a new one.',
    );
  }

  // Invalidate all existing sessions so the old password cannot be used to
  // maintain access after a reset (FIX 3: HIGH-06).
  await deleteAllSessionsForUser(result.userId);

  return json({ ok: true });
}
