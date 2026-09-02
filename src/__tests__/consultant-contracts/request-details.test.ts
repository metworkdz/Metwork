/**
 * Profile-completeness surfacing: the admin can SEE who is blocked, and can
 * ASK them to fix it.
 *
 * `createDraftContract` already refuses an incomplete profile — correctly,
 * since tokens merge once and freeze. But that left the admin able to hit the
 * wall with no way over it. These two pieces close that:
 *   • the picker payload carries `missingIdentity`, from the SAME function the
 *     refusal uses, so the UI can never disagree with the server;
 *   • request-details emails the consultant exactly what is missing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sendMock = vi.fn<(email: string, opts: { missingLabels: string[] }) => Promise<void>>();

vi.mock('@/server/notifications/mock', () => ({
  sendContractDetailsRequestEmail: (e: string, o: { missingLabels: string[] }) => sendMock(e, o),
  sendOtpWhatsApp: async () => true,
  sendOtpSms: async () => true,
  sendContractReadyEmail: vi.fn(async () => {}),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: async () => true }));
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: async () => ({ ok: true, user: { id: 'admin-1', email: 'admin@metwork.dz' } }),
}));

import { db, type MentorRecord, type UserRecord } from '@/server/db/store';
import { missingConsultantIdentity } from '@/server/consultant-contracts/service';
import { POST as requestDetails } from '@/app/api/admin/contracts/request-details/route';
import { GET as listContracts } from '@/app/api/admin/contracts/route';

const ID = 'mentor-incomplete';

function mentor(over: Partial<MentorRecord> = {}): MentorRecord {
  return {
    id: ID, fullName: 'Naima Djebari', position: 'Consultant', imageUrl: '',
    email: 'naima@example.dz', phone: '+213770112233', phoneVerified: true,
    address: '12 Rue Didouche Mourad', idNumber: '109412345678',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  } as MentorRecord;
}

const req = (body: unknown) =>
  new Request('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
  await db.update((d) => {
    d.mentors = [mentor()];
    d.users = [{ id: 'admin-1', role: 'ADMIN', email: 'admin@metwork.dz' } as UserRecord];
    d.consultantContracts = [];
  });
});

describe('the picker sees exactly what the server enforces', () => {
  it('reports no gap for a complete profile', async () => {
    const res = await listContracts();
    const { consultants } = await res.json();
    expect(consultants[0].missingIdentity).toEqual([]);
  });

  it('reports the same fields createDraftContract would refuse on', async () => {
    await db.update((d) => { d.mentors = [mentor({ address: null, idNumber: null })]; });

    const res = await listContracts();
    const { consultants } = await res.json();
    const fromPicker = consultants[0].missingIdentity;
    const fromGate = missingConsultantIdentity((await db.read()).mentors![0]!);

    // If these ever diverge, the UI starts lying about who can be issued a
    // contract — which is the whole reason both read one function.
    expect(fromPicker).toEqual(fromGate);
    expect(fromPicker).toEqual(['address', 'idNumber']);
  });
});

describe('request-details', () => {
  it('emails the consultant naming only what is actually missing', async () => {
    await db.update((d) => { d.mentors = [mentor({ idNumber: null })]; });

    const res = await requestDetails(req({ consultantId: ID }));

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledOnce();
    const [to, opts] = sendMock.mock.calls[0]!;
    expect(to).toBe('naima@example.dz');
    // Address IS filled in, so it must not be asked for.
    expect(opts.missingLabels).toHaveLength(1);
    expect(opts.missingLabels[0]).toMatch(/identité/i);
  });

  it('refuses when the profile is already complete', async () => {
    const res = await requestDetails(req({ consultantId: ID }));
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('404s an unknown consultant', async () => {
    const res = await requestDetails(req({ consultantId: 'nobody' }));
    expect(res.status).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses when there is no address to send to', async () => {
    await db.update((d) => { d.mentors = [mentor({ email: null, idNumber: null })]; });
    const res = await requestDetails(req({ consultantId: ID }));
    expect(res.status).toBe(422);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('records the nudge in the audit log', async () => {
    await db.update((d) => { d.mentors = [mentor({ address: null })]; });
    await requestDetails(req({ consultantId: ID }));
    const logs = (await db.read()).auditLogs ?? [];
    expect(logs.some((l) => l.action === 'CONTRACT_DETAILS_REQUESTED')).toBe(true);
  });
});
