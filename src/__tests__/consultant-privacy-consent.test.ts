/**
 * Consultant self-signup data-processing consent (Algerian Law 18-07).
 *
 *  1. `consultantSignupSchema` REQUIRES `acceptPrivacy === true` — a missing or
 *     false value is rejected with the shared `privacyRequired` message (same
 *     strictness as the entrepreneur signup).
 *  2. `createSelfSignupMentor` stamps `privacyConsent` + a server-side
 *     `privacyAcceptedAt` timestamp on the new PENDING record for the audit trail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { consultantSignupSchema } from '@/server/mentors/schemas';
import { createSelfSignupMentor } from '@/server/mentors/service';
import { db } from '@/server/db/store';

const VALID = {
  fullName: 'Sara Consultant',
  position: 'Growth Advisor',
  email: 'sara@example.com',
  phone: '+213555000111',
};

describe('consultantSignupSchema — privacy consent', () => {
  it('rejects a signup with no consent', () => {
    const res = consultantSignupSchema.safeParse({ ...VALID });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'acceptPrivacy' && i.message === 'privacyRequired')).toBe(true);
    }
  });

  it('rejects acceptPrivacy: false', () => {
    const res = consultantSignupSchema.safeParse({ ...VALID, acceptPrivacy: false });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.message === 'privacyRequired')).toBe(true);
    }
  });

  it('accepts acceptPrivacy: true', () => {
    const res = consultantSignupSchema.safeParse({ ...VALID, acceptPrivacy: true });
    expect(res.success).toBe(true);
  });
});

describe('createSelfSignupMentor — consent audit stamp', () => {
  beforeEach(async () => {
    await db.update((d) => { d.mentors = []; });
  });

  it('stamps privacyConsent + a valid ISO privacyAcceptedAt on the new record', async () => {
    const before = Date.now();
    const result = await createSelfSignupMentor({
      fullName: 'Sara', position: 'Advisor', email: 'sara@example.com', phone: '+213555000111',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mentor.privacyConsent).toBe(true);
      expect(result.mentor.privacyAcceptedAt).toBeTruthy();
      const stamped = new Date(result.mentor.privacyAcceptedAt!).getTime();
      expect(Number.isNaN(stamped)).toBe(false);
      expect(stamped).toBeGreaterThanOrEqual(before);
    }
  });
});
