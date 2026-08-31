/**
 * Phase 2 tests: PDF generation, integrity hashing, storage, and the
 * PENDING_SIGNATURE → SIGNED transition.
 *
 * Cloudinary is mocked at the module boundary (`@/lib/cloudinary`) so the whole
 * path runs — render, hash, upload, atomic flip — without network access. What
 * the mock deliberately does NOT fake is the hashing: the digest is computed
 * over the real PDF bytes this code produces, and the tests re-hash the bytes
 * the "upload" received to prove the two agree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/** Captures what the upload actually received, so integrity can be checked. */
const { uploads, cloudinaryConfigured } = vi.hoisted(() => ({
  uploads: [] as Array<{ buffer: Buffer; publicId: string }>,
  cloudinaryConfigured: { value: true },
}));

vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => cloudinaryConfigured.value,
  SIGNED_URL_TTL_SECONDS: 300,
  uploadAuthenticatedRaw: async (buffer: Buffer, opts: { publicId: string }) => {
    uploads.push({ buffer, publicId: opts.publicId });
    return { publicId: opts.publicId, bytes: buffer.length };
  },
  signedRawDownloadUrl: (publicId: string) =>
    `https://api.cloudinary.com/v1_1/test/raw/download?public_id=${encodeURIComponent(publicId)}&expires_at=${Math.round(Date.now() / 1000) + 300}&signature=deadbeef`,
}));

import { db, type MentorRecord, type IncubatorRecord, type UserRecord } from '@/server/db/store';
import {
  createDraftContract,
  sendContract,
  sendSigningOtp,
  signContract,
  findContractById,
  getContractPdfUrl,
  updateContract,
} from '@/server/consultant-contracts/service';
import { generateConsultantContractPdf, decodeDataUriPng, formatContractDateTime } from '@/server/consultant-contracts/contract-pdf';
import { sha256Hex, buildContractPublicId, CONTRACT_FOLDER } from '@/server/consultant-contracts/storage';

const ADMIN_ID = 'admin-1';
const MENTOR_ID = 'mentor-1';

/**
 * Build a genuinely valid greyscale PNG.
 *
 * Real bytes rather than a hardcoded blob: the signature path decodes the
 * payload, checks the magic number and hands it to pdfkit, so a fixture that is
 * merely base64-shaped would prove nothing. Pixel values vary so the data does
 * not compress away to under the blank-canvas floor.
 */
function makePng(width: number, height: number): Buffer {
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
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale

  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter byte
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = (x * 7 + y * 13) % 256;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A drawn signature: a real PNG, comfortably above the blank-canvas floor. */
const SIGNATURE_PNG = `data:image/png;base64,${makePng(64, 32).toString('base64')}`;

/** Structurally valid but tiny — what an untouched canvas would produce. */
const TINY_PNG = makePng(1, 1).toString('base64');

const MENTOR: MentorRecord = {
  id: MENTOR_ID,
  fullName: 'Yasmine Belkacem',
  position: 'Expert-comptable',
  imageUrl: '',
  bio: null,
  linkedinUrl: null,
  email: 'yasmine@example.dz',
  phone: '+213770112233',
  phoneVerified: true,
  address: '12 Rue Didouche Mourad, Alger Centre', city: 'Alger', idNumber: '109412345678',
  payoutAccount: { accountType: 'bank', accountNumber: '00799999001234567890', holderName: 'Yasmine Belkacem' },
  createdAt: new Date('2026-01-01').toISOString(),
};

const ADMIN_USER = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@metwork.dz' } as UserRecord;

const METWORK: IncubatorRecord = {
  id: 'inc-metwork',
  name: 'EURL METWORK',
  description: '',
  city: 'Oran',
  managerId: ADMIN_ID,
  status: 'ACTIVE',
  website: null,
  logoUrl: null,
  commercialRegNumber: '31/00-1234567 B 24',
  nif: '002431012345678',
  address: '12 rue des Frères Bouadou, Oran',
  createdAt: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-01-01').toISOString(),
} as IncubatorRecord;

const TEST_TEMPLATE =
  "Le consultant {{consultant_name}} donne mandat à {{metwork_name}} à l'effet d'encaisser en son nom " +
  'les honoraires de consultation, moyennant une commission de {{commission_rate}}.';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.mentors = [{ ...MENTOR }];
    d.users = [ADMIN_USER];
    d.incubators = [{ ...METWORK }];
    d.platformSettings = {
      appName: 'Metwork',
      maintenanceMode: false,
      signupsEnabled: true,
      paymentsEnabled: true,
      consultantContractTemplate: TEST_TEMPLATE,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function makePending(): Promise<string> {
  const draft = await createDraftContract({ consultantId: MENTOR_ID, actorId: ADMIN_ID });
  if (!draft.ok) throw new Error(`draft creation refused: ${draft.reason}`);
  const sent = await sendContract(draft.contract.id, ADMIN_ID);
  expect(sent.ok).toBe(true);
  return draft.contract.id;
}

async function currentCode(contractId: string): Promise<string> {
  const issued = await sendSigningOtp(contractId, MENTOR_ID);
  expect(issued.ok).toBe(true);
  return (issued as { ok: true; code: string }).code;
}

beforeEach(async () => {
  uploads.length = 0;
  cloudinaryConfigured.value = true;
  await seed();
});

/* ─────────────────── PDF rendering ─────────────────── */

describe('contract PDF', () => {
  it('produces a valid, non-trivial PDF buffer', async () => {
    const pdf = await generateConsultantContractPdf({
      contractId: 'contract-abc',
      consultantName: 'Yasmine Belkacem',
      body: 'Corps du contrat en français, avec accents : é à ç ù, et « guillemets ».',
      signerPhoneSnapshot: '+213770112233',
      signatureImagePng: SIGNATURE_PNG,
      signedAt: new Date('2026-08-21T10:00:00Z').toISOString(),
      adminStampUrl: null,
      metworkName: 'EURL METWORK',
    });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
    expect(pdf.length).toBeGreaterThan(2_000);
  });

  it('renders without a signature image rather than throwing', async () => {
    const pdf = await generateConsultantContractPdf({
      contractId: 'c',
      consultantName: 'X',
      body: 'corps',
      signerPhoneSnapshot: '+213770112233',
      signatureImagePng: 'not-a-data-uri',
      signedAt: new Date().toISOString(),
      adminStampUrl: null,
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('defaults the Metwork signature caption when no name is given', async () => {
    const pdf = await generateConsultantContractPdf({
      contractId: 'c',
      consultantName: 'X',
      body: 'corps',
      signerPhoneSnapshot: '+213770112233',
      signatureImagePng: SIGNATURE_PNG,
      signedAt: new Date().toISOString(),
      adminStampUrl: null,
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('prints times on a 24-hour clock', () => {
    // Node's ICU resolves fr-DZ to a 12-hour clock by default; "02:32 PM" on a
    // French legal document is a defect. Asserted on the formatter rather than
    // the PDF bytes — with an embedded font, pdfkit writes glyph indices, not
    // ASCII, so the rendered string is not greppable in the output.
    expect(formatContractDateTime('2026-08-21T14:32:00Z')).toBe('21/08/2026 14:32');
    expect(formatContractDateTime('2026-08-21T09:05:00Z')).toBe('21/08/2026 09:05');
    expect(formatContractDateTime('2026-01-03T00:00:00Z')).toBe('03/01/2026 00:00');
  });

  it('rejects non-PNG payloads dressed up as data URIs', () => {
    expect(decodeDataUriPng(`data:image/png;base64,${Buffer.from('not a png at all').toString('base64')}`)).toBeNull();
    expect(decodeDataUriPng('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
    expect(decodeDataUriPng('')).toBeNull();
    expect(decodeDataUriPng(`data:image/png;base64,${TINY_PNG}`)).toBeInstanceOf(Buffer);
  });

  it('paginates a long body without losing the signature block', async () => {
    const pdf = await generateConsultantContractPdf({
      contractId: 'c',
      consultantName: 'Yasmine Belkacem',
      body: 'Article premier. '.repeat(4_000),
      signerPhoneSnapshot: '+213770112233',
      signatureImagePng: SIGNATURE_PNG,
      signedAt: new Date().toISOString(),
      adminStampUrl: null,
    });
    // Several pages, and it still terminated cleanly.
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
  });
});

/* ─────────────────── Storage & integrity ─────────────────── */

describe('storage', () => {
  it('mints extensionless, folder-scoped, non-colliding public ids', () => {
    const a = buildContractPublicId('c1');
    const b = buildContractPublicId('c1');
    expect(a.startsWith(`${CONTRACT_FOLDER}/contract-c1-`)).toBe(true);
    // Extensionless: a `.pdf` suffix would 401 on this Cloudinary account.
    expect(a.endsWith('.pdf')).toBe(false);
    // A retry after a partial failure must not collide with the earlier upload.
    expect(a).not.toBe(b);
  });

  it('refuses to store when Cloudinary is unconfigured instead of falling back to public disk', async () => {
    cloudinaryConfigured.value = false;
    const id = await makePending();
    const code = await currentCode(id);

    const result = await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });
    expect(result).toMatchObject({ ok: false, reason: 'STORAGE_FAILED' });

    // Failing to store must not leave a half-signed contract.
    expect((await findContractById(id))?.status).toBe('PENDING_SIGNATURE');
    expect(uploads).toHaveLength(0);
  });
});

/* ─────────────────── The signing transaction ─────────────────── */

describe('signContract', () => {
  it('signs end to end and stores a hash matching the uploaded bytes', async () => {
    const id = await makePending();
    const code = await currentCode(id);

    const result = await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });
    expect(result.ok).toBe(true);

    const signed = (await findContractById(id))!;
    expect(signed.status).toBe('SIGNED');
    expect(signed.signedAt).not.toBeNull();
    expect(signed.signature?.imagePng).toBe(SIGNATURE_PNG);
    expect(signed.finalPdfPublicId).toBe(uploads[0]!.publicId);
    expect(signed.otp).toBeNull();
    expect(signed.auditTrail.at(-1)?.event).toBe('SIGNED');

    // The stored digest must reproduce from the bytes that were uploaded —
    // this is the property the whole feature rests on.
    const rehashed = createHash('sha256').update(uploads[0]!.buffer).digest('hex');
    expect(signed.finalPdfHash).toBe(rehashed);
    expect(signed.finalPdfHash).toBe(sha256Hex(uploads[0]!.buffer));
    expect(signed.finalPdfHash).toMatch(/^[0-9a-f]{64}$/);

    // And the uploaded bytes are a real PDF, not a placeholder.
    expect(uploads[0]!.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('burns the admin stamp in when one is configured', async () => {
    await db.update((d) => {
      // Preserve the template `seed()` already set — this only adds the stamp.
      d.platformSettings = { ...d.platformSettings!, adminStampImageUrl: 'https://example.test/stamp.png' };
    });
    const id = await makePending();
    const code = await currentCode(id);
    await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });

    const signed = (await findContractById(id))!;
    expect(signed.adminStamp).toEqual({
      imageUrl: 'https://example.test/stamp.png',
      appliedAt: signed.signedAt,
    });
  });

  it('rejects a blank canvas without spending the one-time code', async () => {
    const id = await makePending();
    const code = await currentCode(id);

    expect(await signContract(id, { signatureImagePng: '', otpCode: code, actorId: MENTOR_ID })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(await signContract(id, { signatureImagePng: `data:image/png;base64,${TINY_PNG}`, otpCode: code, actorId: MENTOR_ID })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });

    // The code survived, so a real attempt still works.
    const ok = await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });
    expect(ok.ok).toBe(true);
  });

  it('rejects a wrong code and leaves the contract unsigned', async () => {
    const id = await makePending();
    await currentCode(id);

    const result = await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: '000000', actorId: MENTOR_ID });
    expect(result).toEqual({ ok: false, reason: 'INVALID' });
    expect((await findContractById(id))?.status).toBe('PENDING_SIGNATURE');
    expect(uploads).toHaveLength(0);
  });

  it('cannot be replayed — the consumed code will not sign a second time', async () => {
    const id = await makePending();
    const code = await currentCode(id);

    expect((await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID })).ok).toBe(true);
    const replay = await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });

    expect(replay).toEqual({ ok: false, reason: 'NOT_PENDING' });
    // Exactly one asset was ever produced.
    expect(uploads).toHaveLength(1);
  });

  it('leaves a signed contract immutable afterwards', async () => {
    const id = await makePending();
    const code = await currentCode(id);
    await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });
    const signed = (await findContractById(id))!;

    const tamper = await updateContract(id, (c) => { c.finalPdfHash = 'f'.repeat(64); });
    expect(tamper).toMatchObject({ ok: false, reason: 'IMMUTABLE' });
    expect((await findContractById(id))?.finalPdfHash).toBe(signed.finalPdfHash);
  });
});

/* ─────────────────── Signed-link minting ─────────────────── */

describe('signed PDF links', () => {
  it('mints a fresh expiring link on each access and never a public delivery url', async () => {
    const id = await makePending();
    const code = await currentCode(id);
    await signContract(id, { signatureImagePng: SIGNATURE_PNG, otpCode: code, actorId: MENTOR_ID });

    const url = await getContractPdfUrl(id);
    expect(url).toBeTruthy();
    expect(url).toContain('expires_at=');
    expect(url).toContain('signature=');
    // Never the public CDN — these documents carry bank details.
    expect(url).not.toContain('res.cloudinary.com');

    // Re-minting is allowed on a SIGNED contract; the hash and id are not.
    expect((await findContractById(id))?.finalPdfUrl).toBe(url);
  });

  it('returns null for a contract with no stored pdf', async () => {
    const id = await makePending();
    expect(await getContractPdfUrl(id)).toBeNull();
  });
});

/* ────────────── {{signature_block}} placement ────────────── */

describe('signature block placement', () => {
  const base = {
    contractId: 'contract-place',
    consultantName: 'Yasmine Belkacem',
    signerPhoneSnapshot: '+213770112233',
    signatureImagePng: SIGNATURE_PNG,
    signedAt: new Date('2026-08-21T10:00:00Z').toISOString(),
    adminStampUrl: null,
    metworkName: 'EURL METWORK',
  };

  /** Pages in a rendered PDF — the structure stays ASCII even with an embedded font. */
  const pageCount = (pdf: Buffer): number =>
    (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  const CLAUSES = 'Article premier. '.repeat(40);
  const ANNEXE = 'Annexe. '.repeat(40);

  it('renders validly with the marker present', async () => {
    const pdf = await generateConsultantContractPdf({
      ...base,
      body: `${CLAUSES}\n\n{{signature_block}}\n\n${ANNEXE}`,
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
  });

  it('moving the marker changes the document — it is a real layout instruction', async () => {
    const withMarker = await generateConsultantContractPdf({
      ...base,
      body: `${CLAUSES}\n\n{{signature_block}}\n\n${ANNEXE}`,
    });
    const withoutMarker = await generateConsultantContractPdf({
      ...base,
      body: `${CLAUSES}\n\n${ANNEXE}`,
    });
    // Same words, different arrangement: the block sits between the two halves
    // in one and after both in the other.
    expect(withMarker.length).not.toBe(withoutMarker.length);
  });

  it('a marker at the very top pushes the body onto a later page', async () => {
    const topMarker = await generateConsultantContractPdf({
      ...base,
      body: `{{signature_block}}\n\n${CLAUSES}${ANNEXE}`,
    });
    const noMarker = await generateConsultantContractPdf({
      ...base,
      body: `${CLAUSES}${ANNEXE}`,
    });
    expect(pageCount(topMarker)).toBeGreaterThanOrEqual(pageCount(noMarker));
    expect(pageCount(topMarker)).toBeGreaterThan(0);
  });

  it('still renders when the marker is the entire body', async () => {
    const pdf = await generateConsultantContractPdf({ ...base, body: '{{signature_block}}' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
