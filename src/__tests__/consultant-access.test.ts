/**
 * Unit tests for consultant (mentor) self-service access
 * (src/server/mentors/access.ts).
 *
 * Pins the security-critical auth foundation: single-use, hashed, expiring
 * magic links; an isolated session round-trip (separate cookie, never resolves
 * a user); and the requireConsultant guard. The cookie jar is mocked so the
 * session flow can be exercised end-to-end against the in-memory DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
  }),
}));

import { db, type MentorRecord } from '@/server/db/store';
import {
  issueMentorMagicLink,
  consumeMentorMagicLink,
  createMentorSession,
  setMentorSessionCookie,
  readMentorSession,
  clearMentorSessionCookie,
  requireConsultant,
} from '@/server/mentors/access';

const MENTOR_A: MentorRecord = {
  id: 'm-a', fullName: 'Mentor A', position: 'Advisor', imageUrl: '',
  bio: null, linkedinUrl: null, email: 'a@example.com', consultationFee: 10_000,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const MENTOR_B: MentorRecord = { ...MENTOR_A, id: 'm-b', fullName: 'Mentor B', email: 'b@example.com' };

beforeEach(async () => {
  jar.clear();
  await db.update((d) => {
    d.mentors = [{ ...MENTOR_A }, { ...MENTOR_B }];
    d.mentorAccessTokens = [];
    d.mentorSessions = [];
  });
});

describe('magic link', () => {
  it('issues a token for a matching mentor (case-insensitive) and consumes once', async () => {
    const issued = await issueMentorMagicLink('A@EXAMPLE.COM');
    expect(issued?.mentor.id).toBe('m-a');

    const first = await consumeMentorMagicLink(issued!.token);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.mentorId).toBe('m-a');

    const second = await consumeMentorMagicLink(issued!.token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('CONSUMED');
  });

  it('returns null for an unknown email (no enumeration)', async () => {
    expect(await issueMentorMagicLink('nobody@example.com')).toBeNull();
  });

  it('invalidates a prior unconsumed token when a new one is issued', async () => {
    const t1 = await issueMentorMagicLink('a@example.com');
    const t2 = await issueMentorMagicLink('a@example.com');
    expect((await consumeMentorMagicLink(t1!.token)).ok).toBe(false); // superseded
    expect((await consumeMentorMagicLink(t2!.token)).ok).toBe(true);
  });

  it('rejects an expired token', async () => {
    const issued = await issueMentorMagicLink('a@example.com');
    await db.update((d) => {
      d.mentorAccessTokens[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    const res = await consumeMentorMagicLink(issued!.token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('EXPIRED');
  });

  it('rejects an unknown token', async () => {
    const res = await consumeMentorMagicLink('not-a-real-token');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_FOUND');
  });
});

describe('session + guard', () => {
  it('round-trips a session cookie to the right mentor', async () => {
    const session = await createMentorSession('m-b');
    await setMentorSessionCookie(session);
    expect(await readMentorSession()).toBe('m-b');

    const guard = await requireConsultant();
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.mentorId).toBe('m-b');
  });

  it('returns null / 401 with no session', async () => {
    expect(await readMentorSession()).toBeNull();
    const guard = await requireConsultant();
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });

  it('clears the session on logout', async () => {
    const session = await createMentorSession('m-a');
    await setMentorSessionCookie(session);
    await clearMentorSessionCookie();
    expect(await readMentorSession()).toBeNull();
  });

  it('rejects an expired session', async () => {
    const session = await createMentorSession('m-a');
    await setMentorSessionCookie(session);
    await db.update((d) => {
      d.mentorSessions[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    expect(await readMentorSession()).toBeNull();
  });

  it('returns null when the mentor no longer exists', async () => {
    const session = await createMentorSession('m-a');
    await setMentorSessionCookie(session);
    await db.update((d) => { d.mentors = d.mentors.filter((m) => m.id !== 'm-a'); });
    expect(await readMentorSession()).toBeNull();
  });
});
