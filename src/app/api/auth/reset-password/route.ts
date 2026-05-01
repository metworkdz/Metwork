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

  // Find and validate the reset record inside an atomic update so the token
  // cannot be consumed by a concurrent request.
  const result = await db.update((d) => {
    const idx = d.passwordResets.findIndex(
      (r) => r.tokenHash === tokenHash && !r.consumed,
    );
    if (idx === -1) return { ok: false, reason: 'INVALID_TOKEN' as const };

    const record = d.passwordResets[idx]!;
    if (new Date(record.expiresAt) < new Date()) {
      return { ok: false, reason: 'TOKEN_EXPIRED' as const };
    }

    // Mark consumed immediately — password update happens after this block.
    d.passwordResets[idx] = { ...record, consumed: true };
    return { ok: true, userId: record.userId };
  });

  if (!result.ok) {
    // Both INVALID_TOKEN and TOKEN_EXPIRED return the same 400 to clients
    // so attackers can't distinguish between the two states.
    return jsonError(
      400,
      'INVALID_OR_EXPIRED_TOKEN',
      'This reset link is invalid or has expired. Please request a new one.',
    );
  }

  const newHash = await hashPassword(input.password);

  await db.update((d) => {
    const user = d.users.find((u) => u.id === result.userId);
    if (user) {
      user.passwordHash = newHash;
      user.updatedAt = new Date().toISOString();
    }
  });

  return json({ ok: true });
}
