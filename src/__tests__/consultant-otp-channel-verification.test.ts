/**
 * What a confirmed consultant OTP actually PROVES.
 *
 * The channel that delivered the code is stamped on the OTP record, and at
 * verification it decides which contact detail becomes verified:
 *   whatsapp / sms → the phone is real  → phoneVerified
 *   email          → the address is real → emailVerified (phone stays false)
 *
 * These drive the store-level helpers directly; the route wires them together.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { issueOtp, stampOtpChannel, readOtpChannel, verifyOtp } from '@/server/auth/otp';
import { consultantOtpKey } from '@/server/mentors/access';
import {
  issueMentorEmailToken,
  consumeMentorEmailToken,
} from '@/server/mentors/email-verification';

const MENTOR = 'mentor-otp-1';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.otps = [];
    d.mentors = [];
    d.mentorEmailTokens = [];
    d.mentors.push({
      id: MENTOR,
      fullName: 'QA Consultant',
      position: 'Advisor',
      imageUrl: '/x.png',
      bio: null,
      linkedinUrl: null,
      email: 'qa.consultant@example.com',
      phone: '+213555000111',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never);
  });
}

describe('OTP channel stamping', () => {
  beforeEach(async () => { await seed(); });

  it('records the delivering channel and reads it back before consumption', async () => {
    const key = consultantOtpKey(MENTOR);
    await issueOtp(key);
    await stampOtpChannel(key, 'whatsapp');

    expect(await readOtpChannel(key)).toBe('whatsapp');
  });

  it('leaves the channel unset when delivery never succeeded', async () => {
    const key = consultantOtpKey(MENTOR);
    await issueOtp(key);
    // No stamp — every channel failed.
    expect(await readOtpChannel(key)).toBeNull();
  });

  it('a re-issued code drops the previous channel so a stale one cannot leak through', async () => {
    const key = consultantOtpKey(MENTOR);
    await issueOtp(key);
    await stampOtpChannel(key, 'whatsapp');
    // Resend: issueOtp invalidates the prior unconsumed record.
    await issueOtp(key);
    expect(await readOtpChannel(key)).toBeNull();
  });

  it('the channel is no longer readable once the code is consumed', async () => {
    const key = consultantOtpKey(MENTOR);
    const { code } = await issueOtp(key);
    await stampOtpChannel(key, 'sms');

    expect(await readOtpChannel(key)).toBe('sms');
    const res = await verifyOtp(key, code);
    expect(res.ok).toBe(true);
    // Route reads the channel BEFORE verifying for exactly this reason.
    expect(await readOtpChannel(key)).toBeNull();
  });
});

describe('consultant email verification link', () => {
  beforeEach(async () => { await seed(); });

  it('consuming a valid token flips emailVerified', async () => {
    const token = await issueMentorEmailToken(MENTOR);
    const res = await consumeMentorEmailToken(token);

    expect(res.ok).toBe(true);
    const m = (await db.read()).mentors.find((x) => x.id === MENTOR);
    expect(m?.emailVerified).toBe(true);
  });

  it('is single-use', async () => {
    const token = await issueMentorEmailToken(MENTOR);
    await consumeMentorEmailToken(token);
    const again = await consumeMentorEmailToken(token);

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('CONSUMED');
  });

  it('rejects an unknown token', async () => {
    const res = await consumeMentorEmailToken('not-a-real-token');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_FOUND');
  });

  it('issuing a new link invalidates the previous unconsumed one', async () => {
    const first = await issueMentorEmailToken(MENTOR);
    const second = await issueMentorEmailToken(MENTOR);

    const stale = await consumeMentorEmailToken(first);
    expect(stale.ok).toBe(false);
    expect((await consumeMentorEmailToken(second)).ok).toBe(true);
  });

  it('lives in its own collection — never in the user-scoped emailTokens', async () => {
    await issueMentorEmailToken(MENTOR);
    const d = await db.read();
    expect((d.mentorEmailTokens ?? []).length).toBe(1);
    expect((d.emailTokens ?? []).length).toBe(0);
  });
});
