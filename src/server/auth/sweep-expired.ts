/**
 * Daily clean-up of login material that can no longer be used: sessions, OTP
 * codes, email tokens and remembered devices past their expiry. They would
 * otherwise stay in the store document forever, and every read downloads them.
 *
 * A day's margin past expiry, so a code that just lapsed still answers
 * "expired" rather than "invalid".
 */
import { db } from '@/server/db/store';

const MARGIN_MS = 24 * 3600 * 1000;

export async function sweepExpiredTokens(now = new Date()): Promise<Record<string, number>> {
  const cutoff = new Date(now.getTime() - MARGIN_MS).toISOString();
  const live = <T extends { expiresAt: string }>(rows: T[] | undefined): T[] => (rows ?? []).filter((r) => r.expiresAt > cutoff);
  return db.update((d) => {
    const removed: Record<string, number> = {
      sessions: d.sessions.length - live(d.sessions).length,
      otps: d.otps.length - live(d.otps).length,
      emailTokens: d.emailTokens.length - live(d.emailTokens).length,
      mentorSessions: (d.mentorSessions ?? []).length - live(d.mentorSessions).length,
      mentorDeviceTokens: (d.mentorDeviceTokens ?? []).length - live(d.mentorDeviceTokens).length,
    };
    d.sessions = live(d.sessions);
    d.otps = live(d.otps);
    d.emailTokens = live(d.emailTokens);
    if (removed.mentorSessions) d.mentorSessions = live(d.mentorSessions);
    if (removed.mentorDeviceTokens) d.mentorDeviceTokens = live(d.mentorDeviceTokens);
    return removed;
  });
}
