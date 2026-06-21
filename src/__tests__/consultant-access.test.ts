/**
 * Unit tests for consultant (mentor) self-service access
 * (src/server/mentors/access.ts).
 *
 * Pins the security-critical auth foundation: email → OTP sign-in (single-use,
 * hashed, expiring, attempt-locked via the shared OTP util); an isolated session
 * round-trip (separate cookie, never resolves a user); the requireConsultant
 * guard; the scrypt PIN; and trusted-device tokens. The cookie jar is mocked so
 * the session flow can be exercised end-to-end against the in-memory DB.
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
  findMentorByEmail,
  issueConsultantOtp,
  verifyConsultantOtp,
  createMentorSession,
  setMentorSessionCookie,
  readMentorSession,
  clearMentorSessionCookie,
  requireConsultant,
  setMentorPin,
  changeMentorPin,
  verifyMentorPin,
  mentorHasPin,
  issueMentorDeviceToken,
  validateMentorDeviceToken,
  resolveMentorIdByDeviceToken,
  revokeMentorDeviceToken,
  isValidPinFormat,
} from '@/server/mentors/access';

const MENTOR_A: MentorRecord = {
  id: 'm-a', fullName: 'Mentor A', position: 'Advisor', imageUrl: '',
  bio: null, linkedinUrl: null, email: 'a@example.com', consultationFee: 10_000,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const MENTOR_B: MentorRecord = { ...MENTOR_A, id: 'm-b', fullName: 'Mentor B', email: 'b@example.com' };

/** A 6-digit code guaranteed to differ from `code`. */
const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');

beforeEach(async () => {
  jar.clear();
  await db.update((d) => {
    d.mentors = [{ ...MENTOR_A }, { ...MENTOR_B }];
    d.mentorSessions = [];
    d.mentorDeviceTokens = [];
    d.otps = [];
  });
});

describe('email OTP sign-in', () => {
  it('finds a mentor by email (case-insensitive, trimmed); null otherwise', async () => {
    expect((await findMentorByEmail('  A@EXAMPLE.COM '))?.id).toBe('m-a');
    expect(await findMentorByEmail('nobody@example.com')).toBeNull();
    expect(await findMentorByEmail('')).toBeNull();
  });

  it('issues a 6-digit code for a matching mentor and verifies it once', async () => {
    const issued = await issueConsultantOtp('A@EXAMPLE.COM');
    expect(issued?.mentor.id).toBe('m-a');
    expect(issued?.code).toMatch(/^\d{6}$/);

    const first = await verifyConsultantOtp('m-a', issued!.code);
    expect(first.ok).toBe(true);

    // Single-use: the same code cannot be replayed.
    const second = await verifyConsultantOtp('m-a', issued!.code);
    expect(second.ok).toBe(false);
  });

  it('returns null for an unknown email (no enumeration), but still issues internally', async () => {
    const issued = await issueConsultantOtp('nobody@example.com');
    expect(issued).toBeNull();
    // A sentinel OTP was written so timing matches the matched branch.
    const data = await db.read();
    expect(data.otps.some((o) => o.userId === 'mentor:__no_match__')).toBe(true);
  });

  it('rejects a wrong code', async () => {
    const issued = await issueConsultantOtp('a@example.com');
    const res = await verifyConsultantOtp('m-a', otherCode(issued!.code));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('INVALID');
  });

  it('invalidates a prior unconsumed code when a new one is issued', async () => {
    const a = await issueConsultantOtp('a@example.com');
    const b = await issueConsultantOtp('a@example.com');
    expect((await verifyConsultantOtp('m-a', a!.code)).ok).toBe(false); // superseded
    expect((await verifyConsultantOtp('m-a', b!.code)).ok).toBe(true);
  });

  it('rejects an expired code', async () => {
    const issued = await issueConsultantOtp('a@example.com');
    await db.update((d) => {
      const o = d.otps.find((x) => x.userId === 'mentor:m-a')!;
      o.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    const res = await verifyConsultantOtp('m-a', issued!.code);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('EXPIRED');
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

describe('PIN', () => {
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
  it('issues, validates, resolves, expires and revokes a device token', async () => {
    const device = await issueMentorDeviceToken('m-a', 'Chrome');
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(true);
    // Wrong mentor never matches.
    expect(await validateMentorDeviceToken('m-b', device.token)).toBe(false);
    // Resolve the bound mentor from just the token (entry decision).
    expect(await resolveMentorIdByDeviceToken(device.token)).toBe('m-a');
    expect(await resolveMentorIdByDeviceToken('garbage')).toBeNull();
    expect(await resolveMentorIdByDeviceToken('')).toBeNull();

    // Expire it.
    await db.update((d) => {
      d.mentorDeviceTokens[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    expect(await validateMentorDeviceToken('m-a', device.token)).toBe(false);
    expect(await resolveMentorIdByDeviceToken(device.token)).toBeNull();

    const device2 = await issueMentorDeviceToken('m-a');
    await revokeMentorDeviceToken(device2.token);
    expect(await validateMentorDeviceToken('m-a', device2.token)).toBe(false);
  });

  it('resolves null when the bound mentor no longer exists', async () => {
    const device = await issueMentorDeviceToken('m-a');
    await db.update((d) => { d.mentors = d.mentors.filter((m) => m.id !== 'm-a'); });
    expect(await resolveMentorIdByDeviceToken(device.token)).toBeNull();
  });
});
