/**
 * Password-reset token issuance.
 *
 * The frontend forgot-password form posts an email; we always respond
 * with 204 to avoid email enumeration. If a matching user exists, we
 * issue a short-lived token and log a reset link via the mock notifier.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/server/db/store';

const TOKEN_TTL_MIN = 60;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issuePasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000).toISOString();
  await db.update((d) => {
    d.passwordResets = d.passwordResets.filter((t) => t.userId !== userId || t.consumed);
    d.passwordResets.push({
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      consumed: false,
    });
  });
  return token;
}
