/**
 * "File upload" registration questions — the server half.
 *
 * An applicant attaches a PDF or JPG (a pitch deck, say) to a registration.
 * The bytes go browser → Cloudinary as a PRIVATE asset; what this suite pins is
 * OUR contract around that:
 *
 *   • the signature route only signs for a FILE question of an active listing,
 *     for that question's own path, as an `authenticated` upload
 *   • a submitted file must have been minted for THIS question, must exist, fit
 *     10 MB and really be a PDF/JPG by its bytes — and what gets stored is what
 *     storage measured, never what the client claimed
 *   • free, paid and desk registrations all go through the same verification
 *
 * Cloudinary is stubbed with an in-memory bucket: these tests assert our
 * behaviour, not the vendor's. The real signed round trip needs credentials
 * and is verified by hand on a preview deployment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as SessionModule from '@/server/auth/session';
import { db } from '@/server/db/store';
import { MAX_REGISTRATION_FILE_BYTES } from '@/lib/upload-limits';

const bucket = {
  configured: true,
  assets: new Map<string, Buffer>(),
  destroyed: [] as string[],
  throwOnLookup: false,
  lastSignOptions: undefined as { type?: string } | undefined,
};

vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => bucket.configured,
  signRawUpload: (publicId: string, options?: { type?: 'authenticated' }) => {
    bucket.lastSignOptions = options;
    return {
      cloudName: 'test-cloud',
      apiKey: 'test-key',
      timestamp: 1_700_000_000,
      publicId,
      signature: 'sig-' + publicId,
      ...(options?.type ? { type: options.type } : {}),
      uploadUrl: 'https://api.cloudinary.com/v1_1/test-cloud/raw/upload',
    };
  },
  getAuthenticatedRawResource: async (id: string) => {
    if (bucket.throwOnLookup) throw new Error('Admin API unreachable');
    const b = bucket.assets.get(id);
    return b ? { bytes: b.length } : null;
  },
  readAuthenticatedRawHead: async (id: string, n: number) => {
    const b = bucket.assets.get(id);
    return b ? b.subarray(0, n) : null;
  },
  destroyAuthenticatedRaw: async (id: string) => {
    bucket.destroyed.push(id);
    bucket.assets.delete(id);
  },
}));

// Registrants here are guests: no cookie store exists outside a request.
vi.mock('@/server/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  readSession: async () => null,
}));

import { POST as signRoute } from '@/app/api/registrations/file-signature/route';
import { POST as devUploadRoute } from '@/app/api/registrations/file-upload/route';
import { POST as registerRoute } from '@/app/api/registrations/route';
import {
  buildRegistrationFilePublicId,
  isRegistrationFilePublicId,
  parseRegistrationFilePublicId,
  resolveFileAnswers,
  RegistrationFileError,
  sanitizeRegistrationFileName,
  sniffRegistrationFile,
} from '@/server/registrations/files';
import { findMissingRequiredAnswer } from '@/server/registrations/service';

const INC = 'inc-files';
const EVENT = '33333333-3333-4333-8333-333333333333';
const OTHER_EVENT = '44444444-4444-4444-8444-444444444444';
const FILE_FIELD = '55555555-5555-4555-8555-555555555555';
const OTHER_FILE_FIELD = '66666666-6666-4666-8666-666666666666';
const TEXT_FIELD = '77777777-7777-4777-8777-777777777777';

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 1)]);
const JPG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]);
const EXE_BYTES = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 1)]);

function field(id: string, entityId: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    id, entityType: 'EVENT', entityId, incubatorId: INC, mentorId: null,
    label: `Q-${id.slice(0, 4)}`, labelKey: null, type, options: null, optionKeys: null,
    required: false, order: 0, showWhen: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function event(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, incubatorId: INC, incubatorName: 'Files Incubator', title: 'Demo Day', description: 'x',
    city: 'Alger', imageUrl: null, imageUrls: [], price: 0, capacity: 50, attendeeCount: 0,
    eventDate: '2099-01-01T10:00:00.000Z', isActive: true, slug: `demo-${id.slice(0, 4)}`,
    acceptedPaymentMethods: [], ...extra,
  };
}

async function seed(opts: { fileRequired?: boolean; eventActive?: boolean } = {}) {
  await db.update((d) => {
    d.incubators = [{ id: INC, name: 'Files Incubator', status: 'ACTIVE', managerId: 'm1', email: 'f@x.dz' } as never];
    d.events = [event(EVENT, { isActive: opts.eventActive ?? true }), event(OTHER_EVENT)] as never;
    d.programs = [];
    d.registrations = [];
    d.registrationFormFields = [
      field(FILE_FIELD, EVENT, 'FILE', { label: 'Pitch deck', required: opts.fileRequired ?? false, order: 0 }),
      field(OTHER_FILE_FIELD, EVENT, 'FILE', { label: 'Second file', order: 1 }),
      field(TEXT_FIELD, EVENT, 'SHORT_TEXT', { label: 'Startup', order: 2 }),
    ] as never;
  });
}

/** Put a file in the bucket under a public_id minted for the given question. */
function upload(buf: Buffer, entityId = EVENT, fieldId = FILE_FIELD): string {
  const id = buildRegistrationFilePublicId('EVENT', entityId, fieldId);
  bucket.assets.set(id, buf);
  return id;
}

function json(url: string, body: unknown, ip = '10.0.0.1') {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

const signBody = (over: Record<string, unknown> = {}) => ({
  entityType: 'EVENT', entityId: EVENT, fieldId: FILE_FIELD, size: 2 * 1024 * 1024, mimeType: 'application/pdf', ...over,
});

beforeEach(async () => {
  bucket.configured = true;
  bucket.assets.clear();
  bucket.destroyed = [];
  bucket.throwOnLookup = false;
  bucket.lastSignOptions = undefined;
  await seed();
});

/* ─────────────────────────── Naming and sniffing ─────────────────────────── */

describe('registration file public_id', () => {
  it('is bound to its event and question', () => {
    const id = buildRegistrationFilePublicId('EVENT', EVENT, FILE_FIELD);
    expect(id).toMatch(/^metwork\/registration-files\/EVENT\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(isRegistrationFilePublicId(id, 'EVENT', EVENT, FILE_FIELD)).toBe(true);
    expect(isRegistrationFilePublicId(id, 'EVENT', EVENT, OTHER_FILE_FIELD)).toBe(false);
    expect(isRegistrationFilePublicId(id, 'EVENT', OTHER_EVENT, FILE_FIELD)).toBe(false);
    expect(isRegistrationFilePublicId(id, 'PROGRAM', EVENT, FILE_FIELD)).toBe(false);
  });

  it('refuses ids that are not ours or carry traversal', () => {
    for (const bad of [
      'metwork/pitch-decks/pitch-deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      `metwork/registration-files/EVENT/${EVENT}/${FILE_FIELD}/../../secret`,
      `metwork/registration-files/EVENT/${EVENT}/${FILE_FIELD}/not-a-uuid`,
      '',
    ]) {
      expect(isRegistrationFilePublicId(bad, 'EVENT', EVENT, FILE_FIELD)).toBe(false);
    }
  });

  it('parses back to the question it belongs to', () => {
    const id = buildRegistrationFilePublicId('EVENT', EVENT, FILE_FIELD);
    expect(parseRegistrationFilePublicId(id)).toEqual({ entityType: 'EVENT', entityId: EVENT, fieldId: FILE_FIELD });
    expect(parseRegistrationFilePublicId('metwork/mentors/x')).toBeNull();
  });
});

describe('sniffRegistrationFile', () => {
  it('recognises a PDF and a JPG by their first bytes', () => {
    expect(sniffRegistrationFile(PDF_BYTES.subarray(0, 8))).toBe('application/pdf');
    expect(sniffRegistrationFile(JPG_BYTES.subarray(0, 8))).toBe('image/jpeg');
  });
  it('refuses anything else, whatever it is named', () => {
    expect(sniffRegistrationFile(EXE_BYTES.subarray(0, 8))).toBeNull();
    expect(sniffRegistrationFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull(); // PNG
    expect(sniffRegistrationFile(Buffer.alloc(0))).toBeNull();
  });
});

describe('sanitizeRegistrationFileName', () => {
  it('keeps a readable name and gives it the extension of what the file really is', () => {
    expect(sanitizeRegistrationFileName('TiziTech pitch deck.PDF', 'application/pdf')).toBe('TiziTech pitch deck.pdf');
    expect(sanitizeRegistrationFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpg');
    // The browser sends an extensionless name for the upload itself, so a missing name must still work.
    expect(sanitizeRegistrationFileName(undefined, 'application/pdf')).toBe('file.pdf');
  });
  it('strips path parts, quotes and control characters, and bounds the length', () => {
    expect(sanitizeRegistrationFileName('../../etc/passwd"\r\n.pdf', 'application/pdf')).not.toMatch(/[/\\"\r\n]/);
    expect(sanitizeRegistrationFileName('a'.repeat(500), 'application/pdf').length).toBeLessThanOrEqual(104);
  });
});

/* ─────────────────────────── Signature route ─────────────────────────── */

describe('POST /api/registrations/file-signature', () => {
  it('signs a PRIVATE upload for that question\'s own path', async () => {
    const res = await signRoute(json('/api/registrations/file-signature', signBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('direct');
    expect(body.type).toBe('authenticated');
    expect(bucket.lastSignOptions).toEqual({ type: 'authenticated' });
    expect(isRegistrationFilePublicId(body.publicId, 'EVENT', EVENT, FILE_FIELD)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('api_secret');
  });

  it('accepts a JPG and a file at exactly the limit', async () => {
    expect((await signRoute(json('/api/registrations/file-signature', signBody({ mimeType: 'image/jpeg' })))).status).toBe(200);
    expect((await signRoute(json('/api/registrations/file-signature', signBody({ size: MAX_REGISTRATION_FILE_BYTES })))).status).toBe(200);
  });

  it('rejects an oversize file with a readable message', async () => {
    const res = await signRoute(json('/api/registrations/file-signature', signBody({ size: MAX_REGISTRATION_FILE_BYTES + 1 })));
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe('File exceeds the 10 MB limit.');
  });

  it.each(['image/png', 'application/zip', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])(
    'rejects %s',
    async (mimeType) => {
      const res = await signRoute(json('/api/registrations/file-signature', signBody({ mimeType })));
      expect(res.status).toBe(415);
    },
  );

  it('signs nothing for a question that is not a FILE question', async () => {
    const res = await signRoute(json('/api/registrations/file-signature', signBody({ fieldId: TEXT_FIELD })));
    expect(res.status).toBe(404);
  });

  it('signs nothing for an unknown question, another event\'s question, or an inactive event', async () => {
    const unknown = '88888888-8888-4888-8888-888888888888';
    expect((await signRoute(json('/api/registrations/file-signature', signBody({ fieldId: unknown })))).status).toBe(404);
    expect((await signRoute(json('/api/registrations/file-signature', signBody({ entityId: OTHER_EVENT })))).status).toBe(404);
    await seed({ eventActive: false });
    expect((await signRoute(json('/api/registrations/file-signature', signBody()))).status).toBe(404);
  });

  it('rejects malformed ids before touching the store', async () => {
    const res = await signRoute(json('/api/registrations/file-signature', signBody({ fieldId: 'nope' })));
    expect(res.status).toBe(422);
  });

  it('uses the dev fallback when Cloudinary is unconfigured outside production', async () => {
    bucket.configured = false;
    const res = await signRoute(json('/api/registrations/file-signature', signBody()));
    expect((await res.json()).mode).toBe('proxy');
  });

  it('refuses outright when Cloudinary is unconfigured in production', async () => {
    bucket.configured = false;
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const res = await signRoute(json('/api/registrations/file-signature', signBody()));
      expect(res.status).toBe(503);
    } finally {
      env.NODE_ENV = before;
    }
  });
});

describe('POST /api/registrations/file-upload (dev fallback)', () => {
  it('does not exist when Cloudinary is configured', async () => {
    const fd = new FormData();
    const res = await devUploadRoute(new NextRequest('http://localhost/api/registrations/file-upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(404);
  });
});

/* ─────────────────────────── Verifying answers ─────────────────────────── */

async function resolve(answers: Array<{ fieldId: string; value: string | string[]; fileName?: string }>) {
  return resolveFileAnswers(await db.read(), 'EVENT', EVENT, answers);
}

async function expectRejected(
  answers: Array<{ fieldId: string; value: string | string[]; fileName?: string }>,
  code: string,
) {
  const err = await resolve(answers).then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(RegistrationFileError);
  expect((err as RegistrationFileError).code).toBe(code);
  expect((err as RegistrationFileError).fieldId).toBe(FILE_FIELD);
}

describe('resolveFileAnswers', () => {
  it('stores what storage measured, not what the client claimed', async () => {
    const id = upload(PDF_BYTES);
    const [a] = await resolve([{ fieldId: FILE_FIELD, value: id, fileName: 'TiziTech deck.pdf' }]);
    expect(a).toEqual({
      fieldId: FILE_FIELD,
      value: id,
      file: { name: 'TiziTech deck.pdf', bytes: PDF_BYTES.length, contentType: 'application/pdf' },
    });
  });

  it('labels a JPG as a JPG whatever extension the visitor typed', async () => {
    const id = upload(JPG_BYTES);
    const [a] = await resolve([{ fieldId: FILE_FIELD, value: id, fileName: 'scan.pdf' }]);
    expect(a!.file).toMatchObject({ contentType: 'image/jpeg', name: 'scan.jpg' });
  });

  it('passes ordinary answers through and drops any client-supplied fileName', async () => {
    const out = await resolve([{ fieldId: TEXT_FIELD, value: 'Acme', fileName: 'x.pdf' }]);
    expect(out).toEqual([{ fieldId: TEXT_FIELD, value: 'Acme' }]);
  });

  it('drops an empty file answer, so "required" sees it as missing', async () => {
    expect(await resolve([{ fieldId: FILE_FIELD, value: '  ' }])).toEqual([]);
  });

  it('refuses a file that was uploaded for a different question', async () => {
    await expectRejected([{ fieldId: FILE_FIELD, value: upload(PDF_BYTES, EVENT, OTHER_FILE_FIELD) }], 'INVALID_FILE');
  });

  it('refuses a file that was uploaded for a different event', async () => {
    await expectRejected([{ fieldId: FILE_FIELD, value: upload(PDF_BYTES, OTHER_EVENT, FILE_FIELD) }], 'INVALID_FILE');
  });

  it('refuses an arbitrary asset id or a list of values', async () => {
    await expectRejected([{ fieldId: FILE_FIELD, value: 'metwork/pitch-decks/pitch-deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301' }], 'INVALID_FILE');
    await expectRejected([{ fieldId: FILE_FIELD, value: [upload(PDF_BYTES)] }], 'INVALID_FILE');
  });

  it('refuses a file that was never uploaded', async () => {
    await expectRejected([{ fieldId: FILE_FIELD, value: buildRegistrationFilePublicId('EVENT', EVENT, FILE_FIELD) }], 'FILE_NOT_FOUND');
  });

  it('refuses an empty file', async () => {
    await expectRejected([{ fieldId: FILE_FIELD, value: upload(Buffer.alloc(0)) }], 'FILE_NOT_FOUND');
  });

  it('refuses an oversize file and deletes it', async () => {
    const id = upload(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_REGISTRATION_FILE_BYTES)]));
    await expectRejected([{ fieldId: FILE_FIELD, value: id }], 'FILE_TOO_LARGE');
    expect(bucket.destroyed).toEqual([id]);
  });

  it('refuses something that is not a PDF or JPG by its bytes, and deletes it', async () => {
    const id = upload(EXE_BYTES);
    await expectRejected([{ fieldId: FILE_FIELD, value: id }], 'UNSUPPORTED_FILE_TYPE');
    expect(bucket.destroyed).toEqual([id]);
  });

  it('fails closed, without deleting, when storage cannot be reached', async () => {
    const id = upload(PDF_BYTES);
    bucket.throwOnLookup = true;
    await expectRejected([{ fieldId: FILE_FIELD, value: id }], 'STORAGE_UNAVAILABLE');
    expect(bucket.destroyed).toEqual([]);
  });

  it('keeps only the first answer for a question answered twice', async () => {
    const a = upload(PDF_BYTES);
    const b = upload(PDF_BYTES);
    const out = await resolve([{ fieldId: FILE_FIELD, value: a }, { fieldId: FILE_FIELD, value: b }]);
    expect(out.map((x) => x.value)).toEqual([a]);
  });
});

describe('required FILE questions', () => {
  it('count as missing until a file is attached', async () => {
    await seed({ fileRequired: true });
    const data = await db.read();
    expect(findMissingRequiredAnswer(data, 'EVENT', EVENT, [])).toMatchObject({ fieldId: FILE_FIELD, label: 'Pitch deck' });
    expect(findMissingRequiredAnswer(data, 'EVENT', EVENT, [{ fieldId: FILE_FIELD, value: 'x' }])).toBeNull();
  });

  it('are skipped for a participant a host adds at the desk', async () => {
    await seed({ fileRequired: true });
    expect(findMissingRequiredAnswer(await db.read(), 'EVENT', EVENT, [], { skipFileFields: true })).toBeNull();
  });
});

/* ─────────────────────────── Free registration route ─────────────────────────── */

function register(answers: unknown[], email = 'amina@example.dz') {
  return registerRoute(json('/api/registrations', {
    entityType: 'EVENT', entityId: EVENT, fullName: 'Amina Benali', email, phone: '+213700112233', answers,
  }, `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`));
}

describe('POST /api/registrations with a file', () => {
  it('saves the registration with the verified file facts', async () => {
    const id = upload(PDF_BYTES);
    const res = await register([
      { fieldId: TEXT_FIELD, value: 'TiziTech' },
      // `file` is not part of the request contract: a client cannot write it.
      { fieldId: FILE_FIELD, value: id, fileName: 'deck.pdf', file: { name: 'evil.exe', bytes: 1, contentType: 'x' } },
    ]);
    expect(res.status).toBe(201);

    const reg = (await db.read()).registrations[0]!;
    const fileAnswer = reg.answers.find((a) => a.fieldId === FILE_FIELD)!;
    expect(fileAnswer.value).toBe(id);
    expect(fileAnswer.file).toEqual({ name: 'deck.pdf', bytes: PDF_BYTES.length, contentType: 'application/pdf' });
    expect(reg.answers.find((a) => a.fieldId === TEXT_FIELD)).toEqual({ fieldId: TEXT_FIELD, value: 'TiziTech' });
  });

  it('writes nothing when the file fails verification', async () => {
    const res = await register([{ fieldId: FILE_FIELD, value: upload(EXE_BYTES) }]);
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect((await db.read()).registrations).toHaveLength(0);
  });

  it('refuses a file lifted from another question', async () => {
    const res = await register([{ fieldId: FILE_FIELD, value: upload(PDF_BYTES, EVENT, OTHER_FILE_FIELD) }]);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('INVALID_FILE');
    expect((await db.read()).registrations).toHaveLength(0);
  });

  it('enforces a required file question before any file check', async () => {
    await seed({ fileRequired: true });
    const res = await register([{ fieldId: TEXT_FIELD, value: 'TiziTech' }]);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('MISSING_REQUIRED_FIELD');
  });
});
