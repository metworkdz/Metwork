/**
 * Issuing, emailing and verifying participation certificates.
 *
 * What must hold:
 *  - only confirmed, present participants of the host's OWN program are ever
 *    issued a certificate, whatever ids the request carries;
 *  - a number is handed out once and never changes or repeats;
 *  - marking someone absent, or cancelling them, stops their certificate
 *    verifying — the paper cannot outlive the record;
 *  - sending by email never emails anyone twice unless the host asks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as ImagesModule from '@/server/certificates/images';
import type * as EmailModule from '@/server/notifications/email';

const sendMock = vi.fn(async (_opts: { to: string; subject: string; html: string; attachments?: unknown[] }) => true);

vi.mock('@/server/notifications/email', async (orig) => ({
  ...(await orig<typeof EmailModule>()),
  sendResendEmail: (opts: { to: string; subject: string; html: string }) => sendMock(opts),
}));

vi.mock('@/server/certificates/images', async (orig) => ({
  ...(await orig<typeof ImagesModule>()),
  fetchCertificateImage: vi.fn(async () => null),
}));

const incubatorActor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: incubatorActor }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});

import { db } from '@/server/db/store';
import { DEFAULT_CERTIFICATE_SETTINGS } from '@/server/certificates/types';
import {
  issueCertificates,
  listCertificateParticipants,
  updateCertificateParticipant,
} from '@/server/certificates/issue';
import { verifyCertificate } from '@/server/certificates/verify';
import { certificateEmail, sendCertificates, SEND_BATCH } from '@/server/certificates/send';
import {
  cancelRegistration,
  deleteRegistration,
  incubatorScope,
  mentorScope,
  pruneListingChildrenSync,
} from '@/server/registrations/service';

const NOW = '2026-09-01T00:00:00.000Z';
const A = incubatorScope('inc-a');
const B = incubatorScope('inc-b');
const M = mentorScope('mentor-1');

function program(id: string, owner: { incubatorId?: string; mentorId?: string }, saved = true) {
  return {
    id,
    incubatorId: owner.incubatorId ?? null,
    incubatorName: 'Hub',
    mentorId: owner.mentorId ?? null,
    title: `Programme ${id}`,
    city: 'Oran',
    startDate: '2026-09-08T11:00:00.000Z',
    endDate: '2026-09-20T11:00:00.000Z',
    isActive: true,
    ...(saved ? { certificateSettings: DEFAULT_CERTIFICATE_SETTINGS } : {}),
    createdAt: NOW,
    updatedAt: NOW,
  } as never;
}

function reg(id: string, programId: string, fullName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    entityType: 'PROGRAM',
    entityId: programId,
    incubatorId: programId.startsWith('p-m') ? null : 'inc-a',
    mentorId: programId.startsWith('p-m') ? 'mentor-1' : null,
    userId: null,
    fullName,
    email: `${id}@example.dz`,
    phone: '0555000000',
    answers: [],
    status: 'CONFIRMED',
    clientId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  } as never;
}

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockImplementation(async () => true);
  await db.update((d) => {
    d.users = [];
    d.incubators = [
      { id: 'inc-a', name: 'Hub A', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz' } as never,
      { id: 'inc-b', name: 'Hub B', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz' } as never,
    ];
    d.mentors = [{ id: 'mentor-1', fullName: 'Amina Benali', email: 'amina@x.dz' } as never];
    d.programs = [
      program('p-a', { incubatorId: 'inc-a' }),
      program('p-a2', { incubatorId: 'inc-a' }),
      program('p-unsaved', { incubatorId: 'inc-a' }, false),
      program('p-b', { incubatorId: 'inc-b' }),
      program('p-m1', { mentorId: 'mentor-1' }),
    ];
    d.bookings = [
      { id: 'bk-owing', paymentStatus: 'AWAITING_CASH', cashRemainingAmount: 3000, status: 'CONFIRMED' } as never,
      { id: 'bk-paid', paymentStatus: 'PAID', cashRemainingAmount: 3000, status: 'CONFIRMED' } as never,
    ];
    d.registrations = [
      reg('r-zoe', 'p-a', 'Zoé Mansouri', { bookingId: 'bk-paid' }),
      reg('r-amel', 'p-a', 'Amel Kaci', { bookingId: 'bk-owing', locale: 'ar' }),
      reg('r-bilal', 'p-a', 'Bilal Haddad'),
      reg('r-wait', 'p-a', 'Waiting Person', { status: 'WAITLISTED' }),
      reg('r-cancel', 'p-a', 'Cancelled Person', { status: 'CANCELLED' }),
      reg('r-other', 'p-a2', 'Other Program'),
      reg('r-b', 'p-b', 'Hub B Person', { incubatorId: 'inc-b' }),
      reg('r-m', 'p-m1', 'Mentor Person'),
    ];
    d.certificates = [];
  });
});

describe('the participant list', () => {
  it('lists confirmed participants only, by name, with what they still owe', async () => {
    const list = await listCertificateParticipants('p-a', A);
    expect(list!.saved).toBe(true);
    expect(list!.participants.map((p) => p.fullName)).toEqual(['Amel Kaci', 'Bilal Haddad', 'Zoé Mansouri']);
    expect(list!.participants.map((p) => p.balanceDue)).toEqual([3000, 0, 0]);
    expect(list!.participants.every((p) => !p.absent && p.certificate === null)).toBe(true);
  });

  it('is not found for another owner', async () => {
    expect(await listCertificateParticipants('p-a', B)).toBeNull();
    expect(await listCertificateParticipants('p-a', M)).toBeNull();
    expect(await listCertificateParticipants('p-m1', A)).toBeNull();
  });

  it('cannot touch a registration of another program, another owner, or not confirmed', async () => {
    expect(await updateCertificateParticipant('p-a', A, 'r-other', { absent: true })).toBeNull();
    expect(await updateCertificateParticipant('p-a', A, 'r-b', { absent: true })).toBeNull();
    expect(await updateCertificateParticipant('p-a', A, 'r-wait', { absent: true })).toBeNull();
    expect(await updateCertificateParticipant('p-a', B, 'r-zoe', { absent: true })).toBeNull();
    const d = await db.read();
    expect(d.registrations.filter((r) => r.absent)).toHaveLength(0);
  });
});

describe('issuing', () => {
  it('refuses before the design is saved', async () => {
    await db.update((d) => { d.registrations.push(reg('r-u', 'p-unsaved', 'X Y')); });
    expect(await issueCertificates('p-unsaved', A)).toEqual({ ok: false, reason: 'NOT_SAVED' });
  });

  it('numbers present participants once, in name order, and keeps the numbers', async () => {
    await updateCertificateParticipant('p-a', A, 'r-bilal', { absent: true });
    const first = await issueCertificates('p-a', A);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const year = new Date().getFullYear();
    expect(first.issued.map((i) => [i.certificate.fullName, i.certificate.number])).toEqual([
      ['Amel Kaci', `ATT-${year}-0001`],
      ['Zoé Mansouri', `ATT-${year}-0002`],
    ]);

    // Bilal comes back; the others keep their numbers, he gets the next one.
    await updateCertificateParticipant('p-a', A, 'r-bilal', { absent: false });
    const second = await issueCertificates('p-a', A);
    if (!second.ok) throw new Error('expected ok');
    expect(second.issued.map((i) => i.certificate.number)).toEqual([
      `ATT-${year}-0001`, `ATT-${year}-0003`, `ATT-${year}-0002`,
    ]);
    const d = await db.read();
    expect(d.certificates).toHaveLength(3);
  });

  it('continues the organizer\'s sequence across its programs, separately from other organizers', async () => {
    await issueCertificates('p-a', A);
    const other = await issueCertificates('p-a2', A);
    const mentor = await issueCertificates('p-m1', M);
    const year = new Date().getFullYear();
    if (!other.ok || !mentor.ok) throw new Error('expected ok');
    expect(other.issued[0]!.certificate.number).toBe(`ATT-${year}-0004`);
    expect(mentor.issued[0]!.certificate.number).toBe(`ATT-${year}-0001`);
    expect(mentor.issued[0]!.certificate).toMatchObject({ mentorId: 'mentor-1', incubatorId: null });
  });

  it('never hands the same number out twice, even to simultaneous requests', async () => {
    await Promise.all([issueCertificates('p-a', A), issueCertificates('p-a2', A), issueCertificates('p-a', A)]);
    const d = await db.read();
    const numbers = d.certificates!.map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toHaveLength(4);
  });

  it('ignores ids that are absent, unconfirmed, or belong elsewhere', async () => {
    await updateCertificateParticipant('p-a', A, 'r-zoe', { absent: true });
    const res = await issueCertificates('p-a', A, ['r-zoe', 'r-wait', 'r-cancel', 'r-other', 'r-b', 'r-m']);
    expect(res).toEqual({ ok: false, reason: 'NONE' });
    expect((await db.read()).certificates).toHaveLength(0);
  });

  it('refuses another owner\'s program outright', async () => {
    expect(await issueCertificates('p-a', B)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await issueCertificates('p-a', M)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('prints the corrected name on a reprint, under the same number', async () => {
    const first = await issueCertificates('p-a', A, ['r-zoe']);
    await db.update((d) => { d.registrations.find((r) => r.id === 'r-zoe')!.fullName = 'Zoé Mansouri-Kaci'; });
    await updateCertificateParticipant('p-a', A, 'r-zoe', { civility: 'Mme' });
    const second = await issueCertificates('p-a', A, ['r-zoe']);
    if (!first.ok || !second.ok) throw new Error('expected ok');
    expect(second.issued[0]!.certificate).toMatchObject({
      number: first.issued[0]!.certificate.number,
      fullName: 'Zoé Mansouri-Kaci',
      civility: 'Mme',
    });
  });
});

describe('verification', () => {
  async function tokenOf(registrationId: string) {
    const res = await issueCertificates('p-a', A, [registrationId]);
    if (!res.ok) throw new Error('expected ok');
    return res.issued[0]!.certificate.verifyToken;
  }

  it('confirms a genuine certificate', async () => {
    const token = await tokenOf('r-zoe');
    expect(token).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(await verifyCertificate(token)).toMatchObject({
      status: 'VALID', fullName: 'Zoé Mansouri', programTitle: 'Programme p-a', organizer: 'Hub A',
    });
  });

  it('stops verifying when the participant is marked absent, and again when ticked back', async () => {
    const token = await tokenOf('r-zoe');
    await updateCertificateParticipant('p-a', A, 'r-zoe', { absent: true });
    expect((await verifyCertificate(token)).status).toBe('REVOKED');
    await updateCertificateParticipant('p-a', A, 'r-zoe', { absent: false });
    expect((await verifyCertificate(token)).status).toBe('VALID');
  });

  it('stops verifying when the registration is cancelled', async () => {
    const token = await tokenOf('r-zoe');
    await cancelRegistration('r-zoe', A);
    expect((await verifyCertificate(token)).status).toBe('REVOKED');
  });

  it('knows nothing of an unknown or malformed token', async () => {
    await tokenOf('r-zoe');
    expect(await verifyCertificate('A'.repeat(20))).toEqual({ status: 'NOT_FOUND' });
    expect(await verifyCertificate('../../etc')).toEqual({ status: 'NOT_FOUND' });
    expect(await verifyCertificate('')).toEqual({ status: 'NOT_FOUND' });
  });
});

describe('removing the person removes the certificate', () => {
  it('deleting a cancelled registration deletes its certificate', async () => {
    await issueCertificates('p-a', A, ['r-zoe']);
    await cancelRegistration('r-zoe', A);
    await deleteRegistration('r-zoe', A);
    expect((await db.read()).certificates).toHaveLength(0);
  });

  it('deleting the program deletes its certificates, and only those', async () => {
    await issueCertificates('p-a', A);
    await issueCertificates('p-a2', A);
    await db.update((d) => { pruneListingChildrenSync(d, 'PROGRAM', 'p-a'); });
    const left = (await db.read()).certificates!;
    expect(left.map((c) => c.programId)).toEqual(['p-a2']);
  });
});

describe('sending by email', () => {
  it('sends each present participant their own PDF once, and stamps it', async () => {
    const res = await sendCertificates('p-a', A);
    expect(res).toMatchObject({ ok: true, sent: 3, failed: [], remaining: 0 });
    expect(sendMock).toHaveBeenCalledTimes(3);
    const call = sendMock.mock.calls[0]![0] as { to: string; attachments: Array<{ filename: string; content: Buffer }> };
    expect(call.to).toBe('r-amel@example.dz');
    expect(call.attachments[0]!.filename).toBe('Attestation - Amel Kaci.pdf');
    expect(call.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');

    // Asking again sends nothing more.
    sendMock.mockClear();
    expect(await sendCertificates('p-a', A)).toMatchObject({ ok: true, sent: 0, remaining: 0 });
    expect(sendMock).not.toHaveBeenCalled();
    const d = await db.read();
    expect(d.certificates!.every((c) => c.emailedAt)).toBe(true);
  });

  it('reports a failed address and does not stamp it', async () => {
    sendMock.mockImplementation(async (opts: { to: string }) => opts.to !== 'r-bilal@example.dz');
    const res = await sendCertificates('p-a', A);
    expect(res).toMatchObject({ ok: true, sent: 2, failed: [{ registrationId: 'r-bilal', fullName: 'Bilal Haddad' }] });
    // Skipping it, the run finishes instead of retrying it forever.
    sendMock.mockClear();
    expect(await sendCertificates('p-a', A, { skip: ['r-bilal'] })).toMatchObject({ sent: 0, remaining: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('resends to exactly who the host names, even if already sent', async () => {
    await sendCertificates('p-a', A);
    sendMock.mockClear();
    expect(await sendCertificates('p-a', A, { registrationIds: ['r-zoe'] })).toMatchObject({ sent: 1 });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('two runs at once never email the same person twice', async () => {
    // Slow sends, so the second run starts while the first is mid-batch.
    sendMock.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return true; });
    const [one, two] = await Promise.all([sendCertificates('p-a', A), sendCertificates('p-a', A)]);
    if (!one.ok || !two.ok) throw new Error('expected ok');
    expect(one.sent + two.sent).toBe(3);
    const recipients = sendMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(new Set(recipients).size).toBe(recipients.length);
    // Every claim is released once the runs finish.
    expect((await db.read()).certificates!.every((c) => !c.emailClaimedAt)).toBe(true);
  });

  it('a failed send can be retried at once', async () => {
    sendMock.mockImplementation(async (opts: { to: string }) => opts.to !== 'r-bilal@example.dz');
    await sendCertificates('p-a', A);
    sendMock.mockImplementation(async () => true);
    expect(await sendCertificates('p-a', A)).toMatchObject({ sent: 1, failed: [] });
  });

  it('refuses a resend list longer than one batch', async () => {
    const ids = Array.from({ length: SEND_BATCH + 1 }, (_, i) => `r-${i}`);
    expect(await sendCertificates('p-a', A, { registrationIds: ids })).toEqual({ ok: false, reason: 'TOO_MANY' });
  });

  it('keeps line breaks in a title out of the email subject', async () => {
    await db.update((d) => { d.programs.find((p) => p.id === 'p-a')!.title = 'Formation\r\nBcc: x@evil.dz'; });
    const res = await issueCertificates('p-a', A, ['r-zoe']);
    if (!res.ok) throw new Error('expected ok');
    expect(certificateEmail(res.issued[0]!).subject).not.toMatch(/[\r\n]/);
  });

  it('writes in the participant\'s language and escapes what the host typed', async () => {
    await db.update((d) => {
      d.registrations.find((r) => r.id === 'r-amel')!.fullName = 'Amel <script>alert(1)</script>';
    });
    const res = await issueCertificates('p-a', A, ['r-amel']);
    if (!res.ok) throw new Error('expected ok');
    const { subject, html } = certificateEmail(res.issued[0]!);
    expect(subject).toContain('شهادة');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('/attestation/');
  });
});

describe('the routes', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body: unknown) => new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('downloads everyone as one PDF, and one person as their own file', async () => {
    const { POST } = await import('@/app/api/incubator/programs/[id]/certificates/download/route');
    const all = await POST(post({ mode: 'PRINT' }), ctx('p-a'));
    expect(all.status).toBe(200);
    expect(all.headers.get('x-certificates-issued')).toBe('3');
    expect(all.headers.get('content-disposition')).toBe('attachment; filename="Attestations - Programme p-a.pdf"');

    const one = await POST(post({ mode: 'DIGITAL', registrationIds: ['r-zoe'] }), ctx('p-a'));
    expect(one.headers.get('content-disposition')).toBe('attachment; filename="Attestation - Zoe Mansouri.pdf"');
  });

  it('names an all-Arabic participant\'s file without a dangling dash', async () => {
    const { certificateFilename } = await import('@/server/certificates/issue');
    expect(certificateFilename('Attestation - أمال قاسي')).toBe('Attestation.pdf');
    expect(certificateFilename('Attestation - Zoé "x"\r\nSet-Cookie: a')).toBe('Attestation - Zoe x Set-Cookie a.pdf');
  });

  it('answers 409 before the design is saved, and 404 for someone else\'s program', async () => {
    const { POST } = await import('@/app/api/incubator/programs/[id]/certificates/download/route');
    await db.update((d) => { d.registrations.push(reg('r-u', 'p-unsaved', 'X Y')); });
    expect((await POST(post({}), ctx('p-unsaved'))).status).toBe(409);
    expect((await POST(post({}), ctx('p-b'))).status).toBe(404);
    expect((await db.read()).certificates).toHaveLength(0);
  });

  it('patches attendance through the route', async () => {
    const { PATCH } = await import('@/app/api/incubator/programs/[id]/certificates/participants/route');
    const req = new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: 'r-zoe', absent: true }),
    });
    const res = await PATCH(req, ctx('p-a'));
    expect(res.status).toBe(200);
    expect((await res.json()).participant.absent).toBe(true);

    const empty = new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: 'r-zoe' }),
    });
    expect((await PATCH(empty, ctx('p-a'))).status).toBe(422);
  });
});
