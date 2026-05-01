/**
 * Email verification token issuance and consumption.
 *
 * Tokens are 256 bits of random, base64url-encoded. Only the SHA-256 hash
 * is persisted; the plaintext only travels in the verification link.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/server/db/store';

const TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueEmailToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000).toISOString();
  await db.update((d) => {
    // Invalidate prior unconsumed tokens for this user.
    d.emailTokens = d.emailTokens.filter((t) => t.userId !== userId || t.consumed);
    d.emailTokens.push({ tokenHash: hashToken(token), userId, expiresAt, consumed: false });
  });
  return token;
}

export type ConsumeEmailTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' };

export async function consumeEmailToken(token: string): Promise<ConsumeEmailTokenResult> {
  const tokenHash = hashToken(token);
  return db.update<ConsumeEmailTokenResult>((d) => {
    const rec = d.emailTokens.find((t) => t.tokenHash === tokenHash);
    if (!rec) return { ok: false, reason: 'NOT_FOUND' };
    if (rec.consumed) return { ok: false, reason: 'CONSUMED' };
    if (new Date(rec.expiresAt).getTime() <= Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }
    rec.consumed = true;
    const user = d.users.find((u) => u.id === rec.userId);
    if (user) {
      user.emailVerified = true;
      user.updatedAt = new Date().toISOString();
    }
    return { ok: true, userId: rec.userId };
  });
}
