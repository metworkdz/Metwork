/**
 * Phase 3 route tests: the consultant-facing contract endpoints.
 *
 * The point of these is ownership and tamper-resistance, not happy paths — the
 * signing logic itself is covered in signing.test.ts. What must hold here:
 *
 *   • one consultant can never see or act on another's contract,
 *   • the locked terms are display-only, so a tampered request body cannot
 *     change what is actually signed,
 *   • the wire shape leaks no OTP counters or audit trail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { deflateSync } from 'node:zlib';

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
  }),
}));

const { uploads } = vi.hoisted(() => ({ uploads: [] as Array<{ buffer: Buffer; publicId: string }> }));
vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => true,
  SIGNED_URL_TTL_SECONDS: 300,
  uploadAuthenticatedRaw: async (buffer: Buffer, opts: { publicId: string }) => {
    uploads.push({ buffer, publicId: opts.publicId });
    return { publicId: opts.publicId, bytes: buffer.length };
  },
  signedRawDownloadUrl: (publicId: string) =>
    `https://api.cloudinary.com/v1_1/test/raw/download?public_id=${encodeURIComponent(publicId)}&expires_at=1&signature=x`,
}));

/** Delivery is stubbed — the codes are read from the service's return value. */
vi.mock('@/server/notifications/mock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/notifications/mock')>()),
  sendOtpWhatsApp: async () => true,
  sendOtpSms: async () => true,
}));

import { db, type IncubatorRecord, type MentorRecord, type UserRecord } from '@/server/db/store';
import { createMentorSession, setMentorSessionCookie } from '@/server/mentors/access';
import { createDraftContract, sendContract, sendSigningOtp, findContractById } from '@/server/consultant-contracts/service';
import { GET as listContracts } from '@/app/api/consultant/contracts/route';
import { POST as postOtp } from '@/app/api/consultant/contracts/[id]/otp/route';
import { POST as postSign } from '@/app/api/consultant/contracts/[id]/sign/route';
import { GET as getPdf } from '@/app/api/consultant/contracts/[id]/pdf/route';

const ADMIN_ID = 'admin-1';
const MENTOR_A = 'mentor-a';
const MENTOR_B = 'mentor-b';

function makePng(w: number, h: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 7 + y * 13) % 256;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const SIGNATURE = `data:image/png;base64,${makePng(64, 32).toString('base64')}`;

function mentor(id: string, name: string): MentorRecord {
  return {
    id, fullName: name, position: 'Consultant', imageUrl: '', bio: null, linkedinUrl: null,
    email: `${id}@example.dz`, phone: '+21377011223' + (id === MENTOR_A ? '3' : '4'), phoneVerified: true,
    payoutAccount: { accountType: 'bank', accountNumber: '00799999001234567890', holderName: name },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const METWORK = {
  id: 'inc-metwork', name: 'EURL METWORK', description: '', city: 'Oran', managerId: ADMIN_ID,
  status: 'ACTIVE', website: null, logoUrl: null,
  commercialRegNumber: '31/00-1234567 B 24', nif: '002431012345678', address: '12 rue, Oran',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as IncubatorRecord;

async function signIn(mentorId: string): Promise<void> {
  jar.clear();
  await setMentorSessionCookie(await createMentorSession(mentorId));
}

/**
 * The route handlers are typed against NextRequest, but only ever touch the
 * plain-Request surface (`json()`, `headers`). A cast keeps the tests honest
 * about what they exercise without constructing a full NextRequest.
 */
function req(body?: unknown): NextRequest {
  return new Request('http://localhost/api/consultant/contracts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }) as NextRequest;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A PENDING_SIGNATURE contract for the given consultant. */
async function pendingFor(consultantId: string): Promise<string> {
  const draft = await createDraftContract({
    consultantId,
    contentSnapshot: "Mandat de recouvrement — EURL METWORK.",
    payoutMethod: 'BANK_TRANSFER',
    actorId: ADMIN_ID,
  });
  const sent = await sendContract(draft.id, ADMIN_ID);
  expect(sent.ok).toBe(true);
  return draft.id;
}

beforeEach(async () => {
  jar.clear();
  uploads.length = 0;
  await db.update((d) => {
    d.mentors = [mentor(MENTOR_A, 'Yasmine Belkacem'), mentor(MENTOR_B, 'Karim Haddad')];
    d.users = [{ id: ADMIN_ID, role: 'ADMIN', email: 'admin@metwork.dz' } as UserRecord];
    d.incubators = [{ ...METWORK }];
  });
});

/* ─────────────────── Ownership ─────────────────── */

describe('ownership', () => {
  it('lists only the signed-in consultant\'s own contracts', async () => {
    await pendingFor(MENTOR_A);
    await pendingFor(MENTOR_B);

    await signIn(MENTOR_A);
    const body = await (await listContracts()).json();

    expect(body.contracts).toHaveLength(1);
    const mine = await findContractById(body.contracts[0].id);
    expect(mine?.consultantId).toBe(MENTOR_A);
  });

  it.each([
    ['otp', (id: string) => postOtp(req(), ctx(id))],
    ['sign', (id: string) => postSign(req({ signatureImagePng: SIGNATURE, code: '123456' }), ctx(id))],
    ['pdf', (id: string) => getPdf(new Request('http://localhost/x'), ctx(id))],
  ])('404s on another consultant\'s contract via %s', async (_name, call) => {
    const theirs = await pendingFor(MENTOR_B);
    await signIn(MENTOR_A);

    const res = await call(theirs);
    // Indistinguishable from a contract that does not exist — no enumeration.
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('requires a session', async () => {
    const id = await pendingFor(MENTOR_A);
    jar.clear();
    expect((await listContracts()).status).toBe(401);
    expect((await postOtp(req(), ctx(id))).status).toBe(401);
  });
});

/* ─────────────────── Tamper-resistance ─────────────────── */

describe('locked fields cannot be tampered with', () => {
  it('ignores contract terms supplied in the sign request body', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);

    const issued = await sendSigningOtp(id, MENTOR_A);
    const code = (issued as { ok: true; code: string }).code;

    // A tampered client sends its own terms alongside the signature. The route
    // schema does not read them and the service never looks at the body for
    // terms — they come from the frozen record.
    const res = await postSign(
      req({
        signatureImagePng: SIGNATURE,
        code,
        commissionRate: 0,
        payoutMethod: 'CHEQUE',
        payoutDetails: 'attacker RIB',
        signerPhoneSnapshot: '+213000000000',
        status: 'SIGNED',
      }),
      ctx(id),
    );
    expect(res.status).toBe(200);

    const stored = (await findContractById(id))!;
    expect(stored.commissionRate).toBe(0.2);
    expect(stored.payoutMethod).toBe('BANK_TRANSFER');
    expect(stored.payoutDetails).toContain('7890');
    expect(stored.signerPhoneSnapshot).toBe('+213770112233');
  });

  it('rejects a signature payload that is not a PNG data URL', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);
    const issued = await sendSigningOtp(id, MENTOR_A);
    const code = (issued as { ok: true; code: string }).code;

    const res = await postSign(req({ signatureImagePng: 'https://evil.test/x.png', code }), ctx(id));
    expect(res.status).toBe(422);
    expect((await findContractById(id))?.status).toBe('PENDING_SIGNATURE');
  });

  it('rejects an oversized signature payload', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);
    const issued = await sendSigningOtp(id, MENTOR_A);
    const code = (issued as { ok: true; code: string }).code;

    const huge = `data:image/png;base64,${'A'.repeat(1_600_000)}`;
    const res = await postSign(req({ signatureImagePng: huge, code }), ctx(id));
    expect(res.status).toBe(422);
  });
});

/* ─────────────────── Wire shape ─────────────────── */

describe('serialisation', () => {
  it('never exposes OTP counters or the audit trail', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);
    await sendSigningOtp(id, MENTOR_A);

    const body = await (await listContracts()).json();
    const dto = body.contracts[0];

    expect(dto).not.toHaveProperty('otp');
    expect(dto).not.toHaveProperty('auditTrail');
    expect(dto).not.toHaveProperty('finalPdfPublicId');
    expect(dto).not.toHaveProperty('signature');
    expect(Object.keys(dto).sort()).toEqual([
      'commissionRate', 'contentSnapshot', 'id', 'locked', 'payoutDetails', 'payoutMethod',
      'pdfUrl', 'sentAt', 'signedAt', 'signerPhoneSnapshot', 'status',
    ]);
  });

  it('records VIEWED once, not on every fetch', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);

    await listContracts();
    await listContracts();
    await listContracts();

    const viewed = (await findContractById(id))!.auditTrail.filter((e) => e.event === 'VIEWED');
    expect(viewed).toHaveLength(1);
  });
});

/* ─────────────────── Happy path through the routes ─────────────────── */

describe('signing through the API', () => {
  it('sends a code, signs, and returns a fresh pdf link', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);

    const otpRes = await postOtp(req({ channel: 'whatsapp' }), ctx(id));
    expect(otpRes.status).toBe(200);
    expect((await otpRes.json()).channel).toBe('whatsapp');

    // The route delivers the code out-of-band, so re-issue through the service
    // to learn one. Step past the escalating resend gap first — otherwise this
    // second send is (correctly) throttled and returns no code.
    await db.update((d) => {
      const c = d.consultantContracts!.find((x) => x.id === id)!;
      c.otp!.lastSentAt = new Date(Date.now() - 10 * 60_000).toISOString();
    });
    const reissued = await sendSigningOtp(id, MENTOR_A);
    expect(reissued.ok).toBe(true);
    const code = (reissued as { ok: true; code: string }).code;

    const signRes = await postSign(req({ signatureImagePng: SIGNATURE, code }), ctx(id));
    expect(signRes.status).toBe(200);
    expect((await signRes.json()).contract.status).toBe('SIGNED');

    const pdfRes = await getPdf(new Request('http://localhost/x'), ctx(id));
    expect(pdfRes.status).toBe(200);
    const { url } = await pdfRes.json();
    expect(url).toContain('expires_at=');
    expect(url).not.toContain('res.cloudinary.com');
  });

  it('surfaces the resend throttle as 429 with a retry hint', async () => {
    const id = await pendingFor(MENTOR_A);
    await signIn(MENTOR_A);

    expect((await postOtp(req(), ctx(id))).status).toBe(200);
    const second = await postOtp(req(), ctx(id));

    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error.code).toBe('OTP_THROTTLED');
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });
});
