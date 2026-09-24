/**
 * Where a PDF may fetch an image from, and how much of it.
 *
 * Logos, stamps and signatures are set by hosts and fetched by the server to
 * draw invoices, receipts, contracts and certificates. Without a narrow
 * allowlist that is a request to any address a host types — the shape of an
 * SSRF — and without a cap, a multi-gigabyte file exhausts memory. Every
 * refusal must be a quiet null: the PDF still renders, just without the image.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAllowedPdfImageUrl, fetchPdfImage, MAX_PDF_IMAGE_BYTES } from '@/server/pdf/images';
import { fetchImageBuffer } from '@/server/notifications/receipt';

const OURS = 'dguqgjkuh';
const GOOD = `https://res.cloudinary.com/${OURS}/image/upload/v1/metwork/spaces/logo.png`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A response whose body arrives in `chunks`, optionally declaring a length. */
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
  return new Response(body, { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the allowlist', () => {
  it('admits our own Cloudinary account over https', () => {
    expect(isAllowedPdfImageUrl(GOOD, OURS)).toBe(true);
  });

  it('refuses another account on the same Cloudinary host', () => {
    expect(isAllowedPdfImageUrl('https://res.cloudinary.com/attacker/image/upload/x.png', OURS)).toBe(false);
  });

  it('refuses plain http', () => {
    expect(isAllowedPdfImageUrl(GOOD.replace('https:', 'http:'), OURS)).toBe(false);
  });

  it.each([
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/image.png',
    'https://metwork.dz/assets/metworklogo.png',
    'https://res.cloudinary.com.evil.test/dguqgjkuh/x.png',
    'https://metwork.dz.evil.test/res.cloudinary.com/x.png',
    'file:///etc/passwd',
    'data:image/png;base64,iVBORw0KGgo=',
    '/uploads/incubators/logo.png',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isAllowedPdfImageUrl(url, OURS)).toBe(false);
  });

  it('refuses credentials smuggled into the URL', () => {
    expect(isAllowedPdfImageUrl(`https://user:pass@res.cloudinary.com/${OURS}/x.png`, OURS)).toBe(false);
  });

  it('checks only the host when no cloud name is configured', () => {
    expect(isAllowedPdfImageUrl('https://res.cloudinary.com/anyone/x.png', '')).toBe(true);
    expect(isAllowedPdfImageUrl('https://example.com/x.png', '')).toBe(false);
  });
});

describe('fetching', () => {
  it('never touches the network for a refused URL', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchPdfImage('https://169.254.169.254/x')).toBeNull();
    expect(await fetchPdfImage('http://127.0.0.1:6379/')).toBeNull();
    expect(await fetchPdfImage(null)).toBeNull();
    expect(await fetchPdfImage('')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches an allowed URL without following redirects, under a timeout', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', OURS);
    const fetchSpy = vi.fn(async () => streamed([PNG]));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await fetchPdfImage(GOOD)).toEqual(PNG);
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a body whose declared length is over the cap, without reading it', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', OURS);
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamed([PNG], { 'content-length': String(MAX_PDF_IMAGE_BYTES + 1) })));
    expect(await fetchPdfImage(GOOD)).toBeNull();
  });

  it('stops reading once an undeclared body passes the cap', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', OURS);
    const MB = new Uint8Array(1024 * 1024);
    const chunks = Array.from({ length: 6 }, () => MB); // 6 MB, no content-length
    vi.stubGlobal('fetch', vi.fn(async () => streamed(chunks)));
    expect(await fetchPdfImage(GOOD)).toBeNull();
  });

  it('turns an error status, a rejected fetch or an empty body into null', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', OURS);
    vi.stubGlobal('fetch', vi.fn(async () => streamed([PNG], {}, 404)));
    expect(await fetchPdfImage(GOOD)).toBeNull();

    // What `redirect: 'error'` produces when the server answers with a 3xx.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('unexpected redirect'); }));
    expect(await fetchPdfImage(GOOD)).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => streamed([])));
    expect(await fetchPdfImage(GOOD)).toBeNull();
  });

  it('decodes an inline PNG/JPEG data URI without any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchPdfImage(`data:image/png;base64,${PNG.toString('base64')}`)).toEqual(PNG);
    expect(await fetchPdfImage(`data:image/jpeg;base64,${PNG.toString('base64')}`)).toEqual(PNG);
    expect(await fetchPdfImage('data:text/html;base64,PGgxPg==')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an inline data URI over the cap', async () => {
    const big = 'A'.repeat(Math.ceil((MAX_PDF_IMAGE_BYTES + 3) / 3) * 4);
    expect(await fetchPdfImage(`data:image/png;base64,${big}`)).toBeNull();
  });
});

describe('fetchImageBuffer (invoices, receipts, contracts)', () => {
  it('goes through the same door: a host-set internal address is never requested', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchImageBuffer('http://169.254.169.254/latest/meta-data/iam/')).toBeNull();
    expect(await fetchImageBuffer('https://attacker.test/huge.png')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still returns the image for an allowed logo', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', OURS);
    vi.stubGlobal('fetch', vi.fn(async () => streamed([PNG])));
    expect(await fetchImageBuffer(GOOD)).toEqual(PNG);
  });
});
