/**
 * What an admin's approval decision actually sends.
 *
 * The welcome email is the ONE message a newly approved consultant gets, and it
 * carries a 4 MB attachment — so "exactly once, on the first approval" is a
 * behaviour worth pinning rather than assuming. The claim is written inside the
 * same store update that flips the status, and released again if the send
 * fails, and both halves of that are tested here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, type MentorRecord } from '@/server/db/store';

const sendWelcome = vi.fn<(email: string, opts: { fullName: string; portalUrl: string }) => Promise<boolean>>();
const sendApproval = vi.fn();
const sendRejection = vi.fn();

vi.mock('@/server/notifications/mock', () => ({
  sendConsultantWelcomeEmail: (...args: unknown[]) =>
    (sendWelcome as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));
vi.mock('@/server/notifications/email', () => ({
  sendConsultantApprovalEmail: (...args: unknown[]) => (sendApproval as (...a: unknown[]) => unknown)(...args),
  sendConsultantRejectionEmail: (...args: unknown[]) => (sendRejection as (...a: unknown[]) => unknown)(...args),
}));

const { setMentorApproval } = await import('@/server/mentors/approval');

const MENTOR_ID = 'mentor-welcome-1';
const ADMIN = { id: 'admin-1', email: 'admin@metwork.dz' };

const MENTOR = {
  id: MENTOR_ID,
  fullName: 'Yanis Aït Larbi',
  position: 'Consultant en financement',
  imageUrl: '',
  email: 'yanis@example.dz',
  source: 'SELF',
  approvalStatus: 'PENDING',
  createdAt: new Date('2026-01-01').toISOString(),
} as unknown as MentorRecord;

async function mentor(): Promise<MentorRecord> {
  const d = await db.read();
  return (d.mentors ?? []).find((m) => m.id === MENTOR_ID)!;
}

beforeEach(async () => {
  sendWelcome.mockReset().mockResolvedValue(true);
  sendApproval.mockReset();
  sendRejection.mockReset();
  await db.update((d) => {
    d.mentors = [{ ...MENTOR }];
  });
});

describe('first approval', () => {
  it('sends the welcome email and stamps it on the record', async () => {
    const res = await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });

    expect(res.ok).toBe(true);
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(sendWelcome.mock.calls[0]![0]).toBe('yanis@example.dz');
    expect(sendWelcome.mock.calls[0]![1].fullName).toBe('Yanis Aït Larbi');
    expect(sendWelcome.mock.calls[0]![1].portalUrl).toContain('/mentordashboard');
    expect((await mentor()).welcomeEmailSentAt).toBeTruthy();
  });

  it('replaces the short approval note rather than arriving alongside it', async () => {
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    expect(sendApproval).not.toHaveBeenCalled();
  });
});

describe('re-approval', () => {
  it('never sends a second welcome — nor a second 4 MB guide', async () => {
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    sendWelcome.mockClear();

    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });

    expect(sendWelcome).not.toHaveBeenCalled();
    // They still hear about it: the short localized note is the right message
    // for an approval that reverses an earlier rejection.
    expect(sendApproval).toHaveBeenCalledTimes(1);
  });

  it('survives a rejection in between', async () => {
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'REJECTED', reason: 'Profil incomplet', admin: ADMIN });
    sendWelcome.mockClear();

    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });

    expect(sendRejection).toHaveBeenCalledTimes(1);
    expect(sendWelcome).not.toHaveBeenCalled();
  });
});

describe('when the send fails', () => {
  it('releases the claim so a later approval can retry', async () => {
    sendWelcome.mockResolvedValue(false);

    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    // The stamp exists to prevent a duplicate, not to swallow a lost email.
    expect((await mentor()).welcomeEmailSentAt).toBeFalsy();

    sendWelcome.mockResolvedValue(true);
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    expect(sendWelcome).toHaveBeenCalledTimes(2);
    expect((await mentor()).welcomeEmailSentAt).toBeTruthy();
  });

  it('does not fail the approval itself', async () => {
    sendWelcome.mockRejectedValue(new Error('Resend down'));
    const res = await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    expect(res.ok).toBe(true);
    expect((await mentor()).approvalStatus).toBe('APPROVED');
  });
});

describe('rejection', () => {
  it('sends only the rejection note and claims nothing', async () => {
    await setMentorApproval({
      mentorId: MENTOR_ID, decision: 'REJECTED', reason: 'Profil incomplet', admin: ADMIN,
    });
    expect(sendWelcome).not.toHaveBeenCalled();
    expect(sendRejection).toHaveBeenCalledTimes(1);
    expect((await mentor()).welcomeEmailSentAt).toBeFalsy();
  });
});

describe('no email on file', () => {
  beforeEach(async () => {
    await db.update((d) => {
      const m = (d.mentors ?? []).find((x) => x.id === MENTOR_ID);
      if (m) m.email = null;
    });
  });

  it('approves silently instead of throwing', async () => {
    const res = await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    expect(res.ok).toBe(true);
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it('does not mark them welcomed — nothing was sent', async () => {
    // Stamping here would mark a consultant "welcomed" without a word having
    // been sent, and once they added an address a re-approval would give them
    // the short note instead of the welcome they never received.
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    expect((await mentor()).welcomeEmailSentAt).toBeFalsy();

    // Address added later, approved again → they get the welcome.
    await db.update((d) => {
      const m = (d.mentors ?? []).find((x) => x.id === MENTOR_ID);
      if (m) m.email = 'yanis@example.dz';
    });
    await setMentorApproval({ mentorId: MENTOR_ID, decision: 'APPROVED', admin: ADMIN });
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(sendApproval).not.toHaveBeenCalled();
  });
});
