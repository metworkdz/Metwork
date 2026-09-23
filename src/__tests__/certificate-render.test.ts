/**
 * Drawing participation certificates.
 *
 * The layout itself was checked by eye against the Metwork model; these pin
 * what a render loop cannot: that every template works in every font, that a
 * class becomes one page per person, and — the rule with a real consequence —
 * that a PRINTED certificate carries no signature image or stamp, because it
 * is signed and stamped by hand. A printed certificate with a pre-applied
 * stamp would then be stamped twice.
 */
import fs from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ImagesModule from '@/server/certificates/images';

// No network in tests: every image URL resolves to nothing, and each lookup
// is recorded so the PRINT/DIGITAL rule can be checked.
const fetched: Array<string | null | undefined> = [];
vi.mock('@/server/certificates/images', async (importOriginal) => {
  const actual = await importOriginal<typeof ImagesModule>();
  return {
    ...actual,
    fetchCertificateImage: async (url: string | null | undefined) => { fetched.push(url); return null; },
  };
});

import { renderCertificatesPdf } from '@/server/certificates/render';
import { allCertificateFontPaths } from '@/server/certificates/fonts';
import {
  DEFAULT_CERTIFICATE_SETTINGS,
  type CertificateFont,
  type CertificateSettings,
  type CertificateTemplate,
} from '@/server/certificates/types';

const context = {
  programTitle: 'Devenir un community manager', organizer: 'Metwork', city: 'Oran',
  startDate: '2026-09-08T11:00:00.000Z', endDate: '2026-09-20T11:00:00.000Z',
};
const amina = { fullName: 'Amina Benali', civility: 'Mme' as const, number: 'ATT-2026-0041', verifyUrl: 'https://metwork.dz/fr/verify/ATT-2026-0041' };

const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

function settings(over: Partial<CertificateSettings> = {}): CertificateSettings {
  return { ...DEFAULT_CERTIFICATE_SETTINGS, trainerName: 'Rafik Benabdessadok', ...over };
}

beforeEach(() => { fetched.length = 0; });

describe('every template, every font', () => {
  const templates: CertificateTemplate[] = ['VAGUES', 'DIAGONALES', 'CADRE', 'LATERAL'];
  const fonts: CertificateFont[] = ['MONTSERRAT', 'POPPINS', 'LATO', 'SPECTRAL', 'CORMORANT'];
  const combos = templates.flatMap((t) => fonts.map((f) => [t, f] as const));

  it.each(combos)('renders %s in %s as one valid page', async (template, font) => {
    const buf = await renderCertificatesPdf({
      settings: settings({ template, font }), context, recipients: [amina], mode: 'PRINT',
    });
    expect(isPdf(buf)).toBe(true);
    expect(pages(buf)).toBe(1);
  });

  it('renders at A4 as well as the model\'s A5', async () => {
    const buf = await renderCertificatesPdf({
      settings: settings({ pageSize: 'A4' }), context, recipients: [amina], mode: 'PRINT',
    });
    expect(isPdf(buf)).toBe(true);
    expect(buf.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
  });
});

describe('a whole class', () => {
  it('prints one page per participant, in order, in one file', async () => {
    const recipients = Array.from({ length: 12 }, (_, i) => ({ fullName: `Participant ${i + 1}` }));
    const buf = await renderCertificatesPdf({ settings: settings(), context, recipients, mode: 'PRINT' });
    expect(pages(buf)).toBe(12);
  });

  it('fetches the logo once for the class, not once per page', async () => {
    const recipients = Array.from({ length: 8 }, (_, i) => ({ fullName: `P${i}` }));
    await renderCertificatesPdf({
      settings: settings(), context, recipients, mode: 'PRINT', logoUrl: 'https://example.test/logo.png',
    });
    expect(fetched.filter((u) => u === 'https://example.test/logo.png')).toHaveLength(1);
  });
});

describe('printed versus emailed', () => {
  const withImages = settings({
    showStamp: true,
    signatories: [
      { name: 'Mohamed Benhamada', role: 'Directeur général', imageUrl: 'https://example.test/sig1.png' },
      { name: 'Rafik Benabdessadok', role: 'Formateur', imageUrl: 'https://example.test/sig2.png' },
    ],
  });

  it('never loads a signature or a stamp for a PRINTED certificate — it is signed by hand', async () => {
    await renderCertificatesPdf({
      settings: withImages, context, recipients: [amina], mode: 'PRINT', stampUrl: 'https://example.test/stamp.png',
    });
    expect(fetched).not.toContain('https://example.test/sig1.png');
    expect(fetched).not.toContain('https://example.test/sig2.png');
    expect(fetched).not.toContain('https://example.test/stamp.png');
  });

  it('loads both signatures and the stamp for an EMAILED one', async () => {
    await renderCertificatesPdf({
      settings: withImages, context, recipients: [amina], mode: 'DIGITAL', stampUrl: 'https://example.test/stamp.png',
    });
    expect(fetched).toContain('https://example.test/sig1.png');
    expect(fetched).toContain('https://example.test/sig2.png');
    expect(fetched).toContain('https://example.test/stamp.png');
  });

  it('skips the stamp on an emailed certificate when it is switched off', async () => {
    await renderCertificatesPdf({
      settings: { ...withImages, showStamp: false }, context, recipients: [amina], mode: 'DIGITAL',
      stampUrl: 'https://example.test/stamp.png',
    });
    expect(fetched).not.toContain('https://example.test/stamp.png');
  });
});

describe('what it survives', () => {
  it('an Arabic name and an Arabic program title', async () => {
    const buf = await renderCertificatesPdf({
      settings: settings(), context: { ...context, programTitle: 'مدخل إلى ريادة الأعمال' },
      recipients: [{ fullName: 'أمينة بن علي', civility: 'Mme' }], mode: 'PRINT',
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('a very long paragraph, by shrinking it rather than overflowing', async () => {
    const buf = await renderCertificatesPdf({
      settings: settings({ body: 'Texte très long. '.repeat(60) }), context, recipients: [amina], mode: 'PRINT',
    });
    expect(pages(buf)).toBe(1);
  });

  it('no signatories at all, by falling back to the model\'s single line', async () => {
    const buf = await renderCertificatesPdf({
      settings: settings({ signatories: [] }), context, recipients: [amina], mode: 'PRINT',
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('a certificate not issued yet — no number, so no QR', async () => {
    const buf = await renderCertificatesPdf({
      settings: settings(), context, recipients: [{ fullName: 'Amina Benali' }], mode: 'PRINT',
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('malformed colors, by falling back to the model\'s greens', async () => {
    const buf = await renderCertificatesPdf({
      settings: settings({ primaryColor: 'green', darkColor: '' }), context, recipients: [amina], mode: 'PRINT',
    });
    expect(isPdf(buf)).toBe(true);
  });
});

describe('the fonts on disk', () => {
  it.each(allCertificateFontPaths())('%s exists and is a real TrueType file', (file) => {
    expect(fs.existsSync(file)).toBe(true);
    // 0x00010000 — a half-downloaded file or an HTML error page would pass an
    // existsSync and then render the certificate in the wrong face.
    expect([...fs.readFileSync(file).subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it('ships a licence for every family it embeds', () => {
    const dir = 'src/server/certificates/fonts';
    const licences = fs.readdirSync(dir).filter((f) => f.startsWith('LICENSE-'));
    for (const family of ['Montserrat', 'Poppins', 'Lato', 'Spectral', 'CormorantGaramond']) {
      expect(licences).toContain(`LICENSE-${family}.txt`);
    }
  });

  it('holds no variable font — fontkit cannot instance one', () => {
    for (const file of allCertificateFontPaths()) {
      const d = fs.readFileSync(file);
      const n = d.readUInt16BE(4);
      const tags = Array.from({ length: n }, (_, i) => d.subarray(12 + 16 * i, 16 + 16 * i).toString('latin1'));
      expect(tags, file).not.toContain('fvar');
    }
  });
});
