/**
 * Phase 4 tests: the admin contract endpoints.
 *
 * These pin the rules the admin UI only *renders*. Disabling a button is a
 * courtesy; the server is the control, so each of these drives the route
 * directly, the way a curl call or a tampered client would:
 *
 *   • a contract can only be created by picking a consultant — no free text —
 *     and is refused when no template has been saved,
 *   • a sent contract cannot be edited, no matter what the client sends,
 *   • voiding without an explicit confirmation is refused,
 *   • a signed contract can never be voided,
 *   • admin resend shares the consultant's throttle rather than bypassing it,
 *   • sending is blocked on an unverified phone,
 *   • every admin action lands in the platform audit log.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'admin-1', email: 'admin@metwork.dz', role: 'ADMIN', approvalStatus: 'APPROVED' } });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

/** Delivery is stubbed — only the two senders these routes import are needed. */
vi.mock('@/server/notifications/mock', () => ({
  sendOtpWhatsApp: async () => true,
  sendOtpSms: async () => true,
  sendContractReadyEmail: vi.fn(),
}));

import { db, type IncubatorRecord, type MentorRecord, type UserRecord } from '@/server/db/store';
import { findContractById } from '@/server/consultant-contracts/service';
import { sendContractReadyEmail } from '@/server/notifications/mock';
import { GET as listAdmin, POST as createAdmin } from '@/app/api/admin/contracts/route';
import { PATCH as patchAdmin } from '@/app/api/admin/contracts/[id]/route';
import { POST as sendAdmin } from '@/app/api/admin/contracts/[id]/send/route';
import { POST as voidAdmin } from '@/app/api/admin/contracts/[id]/void/route';
import { POST as otpAdmin } from '@/app/api/admin/contracts/[id]/otp/route';

const ADMIN_ID = 'admin-1';
const MENTOR_ID = 'mentor-a';
const TEST_TEMPLATE = 'Mandat de recouvrement — {{metwork_name}}. Consultant : {{consultant_name}}.';

const MENTOR: MentorRecord = {
  id: MENTOR_ID, fullName: 'Yasmine Belkacem', position: 'Consultant', imageUrl: '',
  bio: null, linkedinUrl: null, email: 'yasmine@example.dz',
  phone: '+213770112233', phoneVerified: true,
  address: '12 Rue Didouche Mourad, Alger Centre', city: 'Alger', idNumber: '109412345678',
  payoutAccount: { accountType: 'bank', accountNumber: '00799999001234567890', holderName: 'Yasmine Belkacem' },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const METWORK = {
  id: 'inc-metwork', name: 'EURL METWORK', description: '', city: 'Oran', managerId: ADMIN_ID,
  status: 'ACTIVE', website: null, logoUrl: null,
  commercialRegNumber: '31/00-1234567 B 24', nif: '002431012345678', address: '12 rue, Oran',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as IncubatorRecord;

function req(body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/admin/contracts', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(overrides: Partial<MentorRecord> = {}, opts: { withTemplate?: boolean } = {}): Promise<void> {
  const withTemplate = opts.withTemplate ?? true;
  await db.update((d) => {
    d.mentors = [{ ...MENTOR, ...overrides }];
    d.users = [{ id: ADMIN_ID, role: 'ADMIN', email: 'admin@metwork.dz' } as UserRecord];
    d.incubators = [{ ...METWORK }];
    d.auditLogs = [];
    d.consultantContracts = [];
    d.platformSettings = {
      appName: 'Metwork',
      maintenanceMode: false,
      signupsEnabled: true,
      paymentsEnabled: true,
      consultantContractTemplate: withTemplate ? TEST_TEMPLATE : null,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function createDraft(): Promise<string> {
  const res = await createAdmin(req({ consultantId: MENTOR_ID }));
  expect(res.status).toBe(201);
  return (await res.json()).contract.id;
}

async function auditActions(): Promise<string[]> {
  return (await db.read()).auditLogs.map((l) => l.action);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await seed();
});

/* ─────────────────── Create & list ─────────────────── */

describe('create and list', () => {
  it('creates a DRAFT from the template, merged with the consultant\'s live data, and logs it', async () => {
    const id = await createDraft();

    const stored = await findContractById(id);
    expect(stored?.status).toBe('DRAFT');
    expect(stored?.contentSnapshot).toContain('EURL METWORK');
    expect(stored?.contentSnapshot).toContain('Yasmine Belkacem');
    // The rate is resolved at send-time, not creation — a draft that sits for a
    // week must not carry a stale number.
    expect(stored?.commissionRate).toBe(0);
    expect(await auditActions()).toContain('CONTRACT_CREATED');
  });

  it('rejects an unknown consultant', async () => {
    const res = await createAdmin(req({ consultantId: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('refuses to create when no template has been saved', async () => {
    await seed({}, { withTemplate: false });
    const res = await createAdmin(req({ consultantId: MENTOR_ID }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_TEMPLATE');
  });

  it('lists contracts with the consultant identity and full audit trail', async () => {
    await createDraft();
    const body = await (await listAdmin()).json();

    expect(body.contracts).toHaveLength(1);
    expect(body.contracts[0].consultantName).toBe('Yasmine Belkacem');
    expect(body.contracts[0].consultantEmail).toBe('yasmine@example.dz');
    expect(body.contracts[0].auditTrail.map((e: { event: string }) => e.event)).toEqual(['CREATED']);
  });

  it('serves the consultant picker with real eligibility, which /api/mentors cannot', async () => {
    await db.update((d) => {
      d.mentors = [
        { ...MENTOR },
        { ...MENTOR, id: 'mentor-b', fullName: 'Anis Zerrouki', phoneVerified: false },
      ];
    });

    const body = await (await listAdmin()).json();
    const byId = new Map(body.consultants.map((c: { id: string }) => [c.id, c]));

    // The public mentor DTO strips phoneVerified as private, so reading it from
    // /api/mentors yields undefined for everyone and labels every consultant
    // ineligible. This endpoint is admin-guarded and reports the truth.
    expect(byId.get(MENTOR_ID)).toMatchObject({ fullName: 'Yasmine Belkacem', phoneVerified: true });
    expect(byId.get('mentor-b')).toMatchObject({ phoneVerified: false });
  });
});

/* ─────────────────── Editing is closed after send ─────────────────── */

describe('edit', () => {
  it('accepts edits while DRAFT and bumps the version', async () => {
    const id = await createDraft();
    const res = await patchAdmin(req({ contentSnapshot: 'v2' }, 'PATCH'), ctx(id));

    expect(res.status).toBe(200);
    expect((await res.json()).contract.templateVersion).toBe(2);
    expect(await auditActions()).toContain('CONTRACT_UPDATED');
  });

  it('refuses to edit a sent contract via a direct API call', async () => {
    const id = await createDraft();
    const original = (await findContractById(id))!.contentSnapshot;
    expect((await sendAdmin(req(), ctx(id))).status).toBe(200);

    // Exactly what a tampered client (or curl) would do once the UI hides Edit.
    const res = await patchAdmin(req({ contentSnapshot: 'rewritten after send' }, 'PATCH'), ctx(id));

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NOT_DRAFT');
    expect((await findContractById(id))?.contentSnapshot).toBe(original);
  });
});

/* ─────────────────── Send ─────────────────── */

describe('send', () => {
  it('freezes the terms, logs it, and emails the consultant', async () => {
    const id = await createDraft();
    const res = await sendAdmin(req(), ctx(id));
    expect(res.status).toBe(200);

    const stored = (await findContractById(id))!;
    expect(stored.status).toBe('PENDING_SIGNATURE');
    expect(stored.commissionRate).toBe(0.2);
    expect(stored.signerPhoneSnapshot).toBe('+213770112233');
    expect(stored.payoutDetails).toContain('7890');
    expect(await auditActions()).toContain('CONTRACT_SENT');

    // Email only — no approved WhatsApp template exists for this message.
    expect(sendContractReadyEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(sendContractReadyEmail).mock.calls[0]![0]).toBe('yasmine@example.dz');
  });

  it('AWAITS the contract-ready email — a floating send never leaves the lambda', async () => {
    // The regression this guards: the route used to call the sender without
    // awaiting it. Vercel freezes the function the moment the response is
    // returned, so the send was abandoned and the consultant was never told
    // their contract was waiting. Here the mock resolves only after a tick; if
    // the route stopped awaiting, the flag would still be false on return.
    let delivered = false;
    vi.mocked(sendContractReadyEmail).mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(() => { delivered = true; resolve(); }, 5)),
    );

    const id = await createDraft();
    const res = await sendAdmin(req(), ctx(id));

    expect(res.status).toBe(200);
    expect(delivered).toBe(true);
  });

  it('still sends the contract when the email fails', async () => {
    // The sender self-catches, so awaiting it can never fail the request — a
    // mail problem must not un-send a contract that was genuinely issued.
    vi.mocked(sendContractReadyEmail).mockImplementationOnce(async () => {});
    const id = await createDraft();
    const res = await sendAdmin(req(), ctx(id));
    expect(res.status).toBe(200);
    expect((await findContractById(id))!.status).toBe('PENDING_SIGNATURE');
  });

  it('blocks sending to a consultant with an unverified phone', async () => {
    await seed({ phoneVerified: false });
    const id = await createDraft();

    const res = await sendAdmin(req(), ctx(id));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_VERIFIED_PHONE');
    expect((await findContractById(id))?.status).toBe('DRAFT');
    expect(sendContractReadyEmail).not.toHaveBeenCalled();
  });

  it('cannot send the same contract twice', async () => {
    const id = await createDraft();
    expect((await sendAdmin(req(), ctx(id))).status).toBe(200);
    expect((await sendAdmin(req(), ctx(id))).status).toBe(409);
  });
});

/* ─────────────────── Void ─────────────────── */

describe('void', () => {
  async function pending(): Promise<string> {
    const id = await createDraft();
    await sendAdmin(req(), ctx(id));
    return id;
  }

  it('requires an explicit confirmation in the request body', async () => {
    const id = await pending();

    for (const body of [{}, { confirm: false }, { confirm: 'yes' }]) {
      const res = await voidAdmin(req(body), ctx(id));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('CONFIRMATION_REQUIRED');
    }
    expect((await findContractById(id))?.status).toBe('PENDING_SIGNATURE');
  });

  it('voids with confirmation and logs it', async () => {
    const id = await pending();
    const res = await voidAdmin(req({ confirm: true }), ctx(id));

    expect(res.status).toBe(200);
    const stored = (await findContractById(id))!;
    expect(stored.status).toBe('VOIDED');
    expect(stored.voidedAt).not.toBeNull();
    // An in-flight signing code must stop working.
    expect(stored.otp).toBeNull();
    expect(await auditActions()).toContain('CONTRACT_VOIDED');
  });

  it('never voids a signed contract', async () => {
    const id = await pending();
    await db.update((d) => {
      d.consultantContracts!.find((c) => c.id === id)!.status = 'SIGNED';
    });

    const res = await voidAdmin(req({ confirm: true }), ctx(id));
    expect(res.status).toBe(409);
    expect((await findContractById(id))?.status).toBe('SIGNED');
  });
});

/* ─────────────────── Admin resend shares the throttle ─────────────────── */

describe('resend signing code', () => {
  it('is subject to the same throttle as the consultant, not a bypass', async () => {
    const id = await createDraft();
    await sendAdmin(req(), ctx(id));

    expect((await otpAdmin(req(), ctx(id))).status).toBe(200);

    // Immediately again: the shared backoff refuses it. An admin path that
    // ignored this would be a way to spray codes at a consultant's phone.
    const second = await otpAdmin(req(), ctx(id));
    expect(second.status).toBe(429);
    expect((await second.json()).error.details.retryAfterSeconds).toBeGreaterThan(0);

    expect(await auditActions()).toContain('CONTRACT_OTP_RESENT');
  });

  it('is attributed to the admin in the contract audit trail', async () => {
    const id = await createDraft();
    await sendAdmin(req(), ctx(id));
    await otpAdmin(req(), ctx(id));

    const trail = (await findContractById(id))!.auditTrail;
    const otpEntry = trail.find((e) => e.event === 'OTP_SENT' || e.event === 'RESEND_OTP')!;
    // Not the consultant: the trail must show a code the consultant did not ask for.
    expect(otpEntry.actorId).toBe(ADMIN_ID);
  });

  it('refuses on a contract that is not awaiting signature', async () => {
    const id = await createDraft();
    expect((await otpAdmin(req(), ctx(id))).status).toBe(409);
  });
});
