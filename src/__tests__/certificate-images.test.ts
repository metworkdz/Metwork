/**
 * Where a certificate may fetch an image from.
 *
 * Signature images are set by hosts — consultants as well as incubators — and
 * the server fetches them. Without a narrow allowlist that is a request to any
 * address a host types, which is the shape of an SSRF: internal services,
 * other people's assets, or a multi-gigabyte file that exhausts memory.
 */
import { describe, it, expect } from 'vitest';
import { isAllowedCertificateImageUrl, fetchCertificateImage } from '@/server/certificates/images';

const OURS = 'dguqgjkuh';

describe('the allowlist', () => {
  it('admits our own Cloudinary account over https', () => {
    expect(isAllowedCertificateImageUrl(
      `https://res.cloudinary.com/${OURS}/image/upload/v1/metwork/uploads/sig.png`, OURS,
    )).toBe(true);
  });

  it('refuses another account on the same Cloudinary host', () => {
    expect(isAllowedCertificateImageUrl('https://res.cloudinary.com/attacker/image/upload/x.png', OURS)).toBe(false);
  });

  it('refuses plain http', () => {
    expect(isAllowedCertificateImageUrl(`http://res.cloudinary.com/${OURS}/image/upload/x.png`, OURS)).toBe(false);
  });

  it.each([
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/image.png',
    'https://metwork.dz.evil.test/res.cloudinary.com/x.png',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isAllowedCertificateImageUrl(url, OURS)).toBe(false);
  });

  it('refuses credentials smuggled into the URL', () => {
    expect(isAllowedCertificateImageUrl(`https://user:pass@res.cloudinary.com/${OURS}/x.png`, OURS)).toBe(false);
  });

  it('does not fetch a refused URL at all', async () => {
    // Refusal happens before any network call — this resolves instantly.
    expect(await fetchCertificateImage('https://169.254.169.254/x')).toBeNull();
    expect(await fetchCertificateImage(null)).toBeNull();
  });
});
