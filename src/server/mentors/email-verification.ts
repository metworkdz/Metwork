/**
 * Consultant email-verification links.
 *
 * Mirrors the user-scoped `@/server/auth/email-verification`, but stores into
 * the separate `mentorEmailTokens` collection: consultants have no UserRecord,
 * and sharing the user table would let the user-facing verify-email route
 * consume a consultant token (burning it without verifying anyone).
 *
 * Only the SHA-256 hash is persisted; the plaintext token travels solely in
 * the emailed link.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/server/db/store';

const TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueMentorEmailToken(mentorId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000).toISOString();
  await db.update((d) => {
    if (!Array.isArray(d.mentorEmailTokens)) d.mentorEmailTokens = [];
    // Invalidate prior unconsumed tokens so only the newest link works.
    d.mentorEmailTokens = d.mentorEmailTokens.filter((t) => t.mentorId !== mentorId || t.consumed);
    d.mentorEmailTokens.push({
      tokenHash: hashToken(token),
      mentorId,
      expiresAt,
      consumed: false,
      createdAt: new Date().toISOString(),
    });
  });
  return token;
}

export type ConsumeMentorEmailTokenResult =
  | { ok: true; mentorId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' };

/** Consume a verification link and flip `emailVerified` on the consultant. */
export async function consumeMentorEmailToken(
  token: string,
): Promise<ConsumeMentorEmailTokenResult> {
  const tokenHash = hashToken(token);
  return db.update<ConsumeMentorEmailTokenResult>((d) => {
    const rec = (d.mentorEmailTokens ?? []).find((t) => t.tokenHash === tokenHash);
    if (!rec) return { ok: false, reason: 'NOT_FOUND' };
    if (rec.consumed) return { ok: false, reason: 'CONSUMED' };
    if (new Date(rec.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED' };

    rec.consumed = true;
    const mentor = (d.mentors ?? []).find((m) => m.id === rec.mentorId);
    if (mentor) {
      mentor.emailVerified = true;
      mentor.updatedAt = new Date().toISOString();
    }
    return { ok: true, mentorId: rec.mentorId };
  });
}
