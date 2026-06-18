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
  generateMentorAccessToken,
  revokeMentorAccessToken,
  resolveMentorIdByAccessToken,
  setMentorPin,
  changeMentorPin,
  verifyMentorPin,
  mentorHasPin,
  issueMentorDeviceToken,
  validateMentorDeviceToken,
  revokeMentorDeviceToken,
  validateMentorAccess,
  isValidPinFormat,
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

describe('durable access token', () => {
  beforeEach(async () => {
    await db.update((d) => { d.mentorDeviceTokens = []; });
  });

  it('generates a token that resolves back to the mentor (hash-only stored)', async () => {
    const gen = await generateMentorAccessToken('m-a');
    expect(gen?.token).toBeTruthy();
    expect(await resolveMentorIdByAccessToken(gen!.token)).toBe('m-a');
    // Only the hash is persisted — never the plaintext.
    const data = await db.read();
    const mentor = data.mentors.find((m) => m.id === 'm-a')!;
    expect(mentor.accessTokenHash).toBeTruthy();
    expect(mentor.accessTokenHash).not.toBe(gen!.token);
  });

  it('returns null when generating for an unknown mentor', async () => {
    expect(await generateMentorAccessToken('nope')).toBeNull();
  });

  it('rotation invalidates the previous token and remembered devices', async () => {
    const first = await generateMentorAccessToken('m-a');
    const device = await issueMentorDeviceToken('m-a');
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(true);

    const second = await generateMentorAccessToken('m-a');
    expect(await resolveMentorIdByAccessToken(first!.token)).toBeNull(); // old link dead
    expect(await resolveMentorIdByAccessToken(second!.token)).toBe('m-a');
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(false); // devices revoked
  });

  it('revoke clears the token and devices', async () => {
    const gen = await generateMentorAccessToken('m-a');
    await issueMentorDeviceToken('m-a');
    expect(await revokeMentorAccessToken('m-a')).toBe(true);
    expect(await resolveMentorIdByAccessToken(gen!.token)).toBeNull();
    const data = await db.read();
    expect(data.mentorDeviceTokens.filter((t) => t.mentorId === 'm-a')).toHaveLength(0);
  });

  it('resolveMentorIdByAccessToken returns null for empty/unknown tokens', async () => {
    expect(await resolveMentorIdByAccessToken('')).toBeNull();
    expect(await resolveMentorIdByAccessToken('garbage')).toBeNull();
  });
});

describe('PIN', () => {
  beforeEach(async () => {
    await db.update((d) => { d.mentorDeviceTokens = []; });
  });

  it('validates PIN format (4–6 digits)', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12ab')).toBe(false);
  });

  it('sets a PIN once, then verifies it; rejects re-set and bad format', async () => {
    expect(await mentorHasPin('m-a')).toBe(false);
    expect((await setMentorPin('m-a', '4321')).ok).toBe(true);
    expect(await mentorHasPin('m-a')).toBe(true);
    expect(await verifyMentorPin('m-a', '4321')).toBe(true);
    expect(await verifyMentorPin('m-a', '0000')).toBe(false);

    const reset = await setMentorPin('m-a', '5555');
    expect(reset.ok).toBe(false);
    if (!reset.ok) expect(reset.reason).toBe('ALREADY_SET');

    const bad = await setMentorPin('m-b', '12');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('INVALID_FORMAT');
  });

  it('change requires the current PIN and revokes remembered devices', async () => {
    await setMentorPin('m-a', '1111');
    const device = await issueMentorDeviceToken('m-a');
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(true);

    const wrong = await changeMentorPin('m-a', '0000', '2222');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe('WRONG_PIN');

    const ok = await changeMentorPin('m-a', '1111', '2222');
    expect(ok.ok).toBe(true);
    expect(await verifyMentorPin('m-a', '2222')).toBe(true);
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(false);
  });

  it('change fails when no PIN is set yet', async () => {
    const res = await changeMentorPin('m-a', '1111', '2222');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NO_PIN');
  });
});

describe('remembered device tokens', () => {
  beforeEach(async () => {
    await db.update((d) => { d.mentorDeviceTokens = []; });
  });

  it('issues, validates, expires and revokes a device token', async () => {
    const device = await issueMentorDeviceToken('m-a', 'Chrome');
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(true);
    // Wrong mentor never matches.
    expect(await validateMentorDeviceToken('m-b', device.token)).toBe(false);

    // Expire it.
    await db.update((d) => {
      d.mentorDeviceTokens[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(false);

    const device2 = await issueMentorDeviceToken('m-a');
    await revokeMentorDeviceToken(device2.token);
    expect(await validateMentorDeviceToken('m-a', device2.token)).toBe(false);
  });
});

describe('validateMentorAccess (combined gate)', () => {
  beforeEach(async () => {
    await db.update((d) => { d.mentorDeviceTokens = []; });
  });

  it('returns null for an unknown token', async () => {
    expect(await validateMentorAccess('bad-token', { pin: '1234' })).toBeNull();
  });

  it('returns null when no valid credential is supplied', async () => {
    const gen = await generateMentorAccessToken('m-a');
    await setMentorPin('m-a', '1234');
    expect(await validateMentorAccess(gen!.token, {})).toBeNull();
    expect(await validateMentorAccess(gen!.token, { pin: '9999' })).toBeNull();
  });

  it('returns the mentorId with a correct PIN', async () => {
    const gen = await generateMentorAccessToken('m-a');
    await setMentorPin('m-a', '1234');
    expect(await validateMentorAccess(gen!.token, { pin: '1234' })).toBe('m-a');
  });

  it('returns the mentorId with a valid device token', async () => {
    const gen = await generateMentorAccessToken('m-a');
    const device = await issueMentorDeviceToken('m-a');
    expect(await validateMentorAccess(gen!.token, { deviceToken: device.token })).toBe('m-a');
  });
});
