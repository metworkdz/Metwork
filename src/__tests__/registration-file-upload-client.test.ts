/**
 * The browser half of a registration file upload, with its two transports
 * injected. What matters: the right fields go to Cloudinary (including the
 * signed `type=authenticated` and an EXTENSIONLESS filename), every failure
 * becomes an error a visitor can act on, and nothing is sent for a file that
 * can be refused up front.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RegistrationFileUploadError,
  checkRegistrationFile,
  effectiveMime,
  formatFileSize,
  uploadRegistrationFile,
  type UploadDeps,
  type UploadResponse,
} from '@/lib/registration-file-upload';
import { MAX_REGISTRATION_FILE_BYTES } from '@/lib/upload-limits';
import en from '@/i18n/messages/en.json';
import fr from '@/i18n/messages/fr.json';
import ar from '@/i18n/messages/ar.json';

const ARGS = {
  entityType: 'EVENT' as const,
  entityId: '11111111-1111-4111-8111-111111111111',
  fieldId: '22222222-2222-4222-8222-222222222222',
};
const pdf = (size = 2048, name = 'deck.pdf', type = 'application/pdf') =>
  new File([new Uint8Array(size)], name, { type });

const DIRECT_SIG = {
  mode: 'direct', uploadUrl: 'https://api.cloudinary.com/v1_1/c/raw/upload', apiKey: 'k',
  timestamp: 1700000000, publicId: 'metwork/registration-files/EVENT/e/f/u', signature: 'sig', type: 'authenticated',
};

function deps(over: Partial<{ sig: UploadResponse; up: UploadResponse | Error }> = {}) {
  const calls = { json: [] as Array<{ url: string; body: unknown }>, forms: [] as Array<{ url: string; form: FormData }> };
  const d: UploadDeps = {
    postJson: vi.fn(async (url, body) => {
      calls.json.push({ url, body });
      return over.sig ?? { status: 200, body: DIRECT_SIG };
    }),
    postForm: vi.fn(async (url, form, onProgress) => {
      calls.forms.push({ url, form });
      onProgress(0.5);
      if (over.up instanceof Error) throw over.up;
      return over.up ?? { status: 200, body: { public_id: 'x' } };
    }),
  };
  return { d, calls };
}

describe('type and size checks (before any bytes move)', () => {
  it('accepts a PDF and a JPG', () => {
    expect(checkRegistrationFile(pdf())).toBe('application/pdf');
    expect(checkRegistrationFile({ name: 'a.jpg', type: 'image/jpeg', size: 10 })).toBe('image/jpeg');
  });
  it('falls back to the extension when the phone sends no type', () => {
    expect(effectiveMime({ name: 'Deck.PDF', type: '' })).toBe('application/pdf');
    expect(effectiveMime({ name: 'photo.jpeg', type: 'application/octet-stream' })).toBe('image/jpeg');
  });
  it('refuses a named-but-wrong type even if the extension looks right', () => {
    expect(effectiveMime({ name: 'deck.pdf', type: 'application/zip' })).toBeNull();
  });
  it.each([
    ['png', { name: 'a.png', type: 'image/png', size: 10 }, 'TYPE'],
    ['pptx', { name: 'a.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 10 }, 'TYPE'],
    ['over 10 MB', { name: 'a.pdf', type: 'application/pdf', size: MAX_REGISTRATION_FILE_BYTES + 1 }, 'SIZE'],
    ['empty', { name: 'a.pdf', type: 'application/pdf', size: 0 }, 'EMPTY'],
  ])('refuses %s', (_n, file, code) => {
    expect(() => checkRegistrationFile(file)).toThrowError(expect.objectContaining({ code }));
  });
  it('accepts a file at exactly the limit', () => {
    expect(() => checkRegistrationFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_REGISTRATION_FILE_BYTES })).not.toThrow();
  });
  it('formats sizes for the file card', () => {
    expect(formatFileSize(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatFileSize(310 * 1024)).toBe('310 KB');
    expect(formatFileSize(10)).toBe('1 KB');
  });
});

describe('uploadRegistrationFile — direct to Cloudinary', () => {
  it('sends exactly what was signed, privately, with an extensionless filename', async () => {
    const { d, calls } = deps();
    const progress: number[] = [];
    const out = await uploadRegistrationFile({ ...ARGS, file: pdf(), onProgress: (f) => progress.push(f) }, d);

    expect(out).toEqual({ publicId: DIRECT_SIG.publicId });
    expect(calls.json[0]).toEqual({
      url: '/api/registrations/file-signature',
      body: { ...ARGS, size: 2048, mimeType: 'application/pdf' },
    });
    const { url, form } = calls.forms[0]!;
    expect(url).toBe(DIRECT_SIG.uploadUrl);
    expect(form.get('public_id')).toBe(DIRECT_SIG.publicId);
    expect(form.get('signature')).toBe('sig');
    expect(form.get('api_key')).toBe('k');
    expect(form.get('timestamp')).toBe('1700000000');
    expect(form.get('type')).toBe('authenticated');
    expect((form.get('file') as File).name).toBe('registration-file'); // no .pdf: it would change the public_id
    expect(progress).toContain(1);
  });

  it('sends nothing at all for a file it can already refuse', async () => {
    const { d, calls } = deps();
    await expect(uploadRegistrationFile({ ...ARGS, file: pdf(10, 'a.png', 'image/png') }, d)).rejects.toMatchObject({ code: 'TYPE' });
    expect(calls.json).toHaveLength(0);
    expect(calls.forms).toHaveLength(0);
  });

  it.each([
    [429, undefined, 'RATE_LIMITED'],
    [415, 'UNSUPPORTED_FILE_TYPE', 'TYPE'],
    [413, 'FILE_TOO_LARGE', 'SIZE'],
    [503, 'UPLOAD_UNAVAILABLE', 'UNAVAILABLE'],
    [404, 'NOT_FOUND', 'GENERIC'],
    [500, undefined, 'GENERIC'],
  ])('maps a %s from the signature route (%s) to %s', async (status, code, expected) => {
    const { d, calls } = deps({ sig: { status, body: { error: { code } } } });
    await expect(uploadRegistrationFile({ ...ARGS, file: pdf() }, d)).rejects.toMatchObject({ code: expected });
    expect(calls.forms).toHaveLength(0);
  });

  it('reports a Cloudinary rejection as a service error, never a raw status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { d } = deps({ up: { status: 401, body: { error: { message: 'Invalid Signature' } } } });
    await expect(uploadRegistrationFile({ ...ARGS, file: pdf() }, d)).rejects.toMatchObject({ code: 'SERVICE' });
    spy.mockRestore();
  });

  it('reports a dropped connection as a network error', async () => {
    const { d } = deps({ up: new Error('network') });
    await expect(uploadRegistrationFile({ ...ARGS, file: pdf() }, d)).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('reports a cancel as CANCELLED, not as a failure', async () => {
    const { d } = deps({ up: new DOMException('Aborted', 'AbortError') });
    const err = await uploadRegistrationFile({ ...ARGS, file: pdf() }, d).catch((e) => e);
    expect(err).toBeInstanceOf(RegistrationFileUploadError);
    expect(err.code).toBe('CANCELLED');
  });

  it('refuses an incomplete signature rather than posting to nowhere', async () => {
    const { d, calls } = deps({ sig: { status: 200, body: { mode: 'direct', uploadUrl: 'https://x' } } });
    await expect(uploadRegistrationFile({ ...ARGS, file: pdf() }, d)).rejects.toMatchObject({ code: 'GENERIC' });
    expect(calls.forms).toHaveLength(0);
  });
});

describe('uploadRegistrationFile — local dev fallback', () => {
  it('posts the file to our own route and returns its id', async () => {
    const { d, calls } = deps({ sig: { status: 200, body: { mode: 'proxy' } }, up: { status: 201, body: { publicId: 'local/id' } } });
    const out = await uploadRegistrationFile({ ...ARGS, file: pdf() }, d);
    expect(out).toEqual({ publicId: 'local/id' });
    const { url, form } = calls.forms[0]!;
    expect(url).toBe('/api/registrations/file-upload');
    expect(form.get('fieldId')).toBe(ARGS.fieldId);
    expect(form.get('entityId')).toBe(ARGS.entityId);
    expect(form.get('type')).toBeNull();
  });

  it('maps a rejection from the local route', async () => {
    const { d } = deps({ sig: { status: 200, body: { mode: 'proxy' } }, up: { status: 415, body: { error: { code: 'UNSUPPORTED_FILE_TYPE' } } } });
    await expect(uploadRegistrationFile({ ...ARGS, file: pdf() }, d)).rejects.toMatchObject({ code: 'TYPE' });
  });
});

describe('registration.* file strings', () => {
  const KEYS = [
    'fileChoose', 'fileHint', 'fileUploading', 'fileAttached', 'fileReplace', 'fileRemove', 'fileCancel',
    'errorFileType', 'errorFileSize', 'errorFileEmpty', 'errorFileNetwork', 'errorFileService',
    'errorFileUnavailable', 'errorFileUpload', 'errorFileLost',
  ];
  describe.each([['en', en], ['fr', fr], ['ar', ar]] as const)('%s', (_l, bundle) => {
    const reg = (bundle as unknown as { registration: Record<string, string> }).registration;
    it('has every key', () => {
      for (const k of KEYS) expect(reg[k]?.trim(), k).toBeTruthy();
    });
    it('keeps the placeholders the component fills in', () => {
      expect(reg.fileHint).toContain('{max}');
      expect(reg.errorFileSize).toContain('{max}');
      expect(reg.fileUploading).toContain('{percent}');
    });
  });
});
