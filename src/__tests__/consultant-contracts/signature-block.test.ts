/**
 * Signature-block geometry on the consultant contract.
 *
 * The two marks in the block are drawn images, so nothing about their size or
 * placement is visible in the text of the PDF. These tests read the actual
 * placement matrices back out of the rendered content stream — the only way to
 * assert "the stamp is half again as large" and "both marks sit on their own
 * ruled line" rather than merely assuming it.
 *
 * The stamp fixture is 632 × 455 px because that is the real cachet's pixel
 * size: pdfkit's `fit` scales by whichever axis binds first, and for that
 * aspect the height binds — which is exactly why raising the box to 120 pt
 * produces a clean 1.5×. A fixture with a different aspect would prove nothing
 * about the real document.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import {
  generateConsultantContractPdf,
  metworkLegalName,
} from '@/server/consultant-contracts/contract-pdf';

/* ─────────────────── PNG fixture ─────────────────── */

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A real, decodable 8-bit greyscale PNG of exactly the given pixel size. */
function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  // colour type 0 (greyscale), deflate, adaptive filtering, no interlace
  const raw = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/* ─────────────────── PDF placement readback ─────────────────── */

interface Placement {
  /** Drawn size in points. */
  w: number;
  h: number;
  /** In pdfkit's top-left space: the distance from the top of the page. */
  top: number;
  bottom: number;
}

/**
 * Every image placement in the document, in draw order.
 *
 * pdfkit emits `w 0 0 -h x (top + h) cm` before each `/Ixx Do`, in its own
 * top-left coordinate space — so the sixth number is the image's BOTTOM edge
 * and the top is recovered by subtracting the height.
 */
function imagePlacements(pdf: Buffer): Placement[] {
  const found: Placement[] = [];
  const latin = pdf.toString('latin1');
  const streams = /stream\r?\n/g;
  let s: RegExpExecArray | null;
  while ((s = streams.exec(latin))) {
    const from = s.index + s[0].length;
    const to = latin.indexOf('endstream', from);
    if (to < 0) continue;
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(latin.slice(from, to), 'latin1')).toString('latin1');
    } catch {
      continue; // not a content stream (image data, font file, …)
    }
    const draws = /([\d.-]+) 0 0 (-?[\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*\/\w+ Do/g;
    let d: RegExpExecArray | null;
    while ((d = draws.exec(content))) {
      const w = Number(d[1]);
      const h = Math.abs(Number(d[2]));
      const bottom = Number(d[4]);
      found.push({ w, h, top: bottom - h, bottom });
    }
  }
  return found;
}

/* ─────────────────── Tests ─────────────────── */

const STAMP = makePng(632, 455); // the real cachet's pixel dimensions
const SIGNATURE = makePng(600, 200); // a typical drawn-signature canvas

const base = {
  contractId: 'contract-geometry',
  consultantName: 'Yasmine Belkacem',
  body: 'Article 1 — Objet\nCorps du contrat.\n\n{{signature_block}}',
  signerPhoneSnapshot: '+213770112233',
  signedAt: '2026-08-21T10:00:00Z',
};

describe('signature block geometry', () => {
  it('draws the company stamp 1.5× the consultant signature box', async () => {
    const pdf = await generateConsultantContractPdf({
      ...base,
      signatureImagePng: dataUri(SIGNATURE),
      adminStampUrl: dataUri(STAMP),
    });

    // Placement order: brand wordmark, then stamp (left), then signature (right).
    const images = imagePlacements(pdf);
    expect(images).toHaveLength(3);
    const [, stamp, signature] = images as [Placement, Placement, Placement];

    // 120 pt tall — 1.5× the 80 pt box the consultant's signature still uses.
    expect(stamp.h).toBeCloseTo(120, 3);
    expect(stamp.w).toBeCloseTo((632 / 455) * 120, 2);
    expect(stamp.h / 80).toBeCloseTo(1.5, 6);

    // The signature is width-limited by its column, and is NOT enlarged.
    expect(signature.h).toBeLessThan(stamp.h);
    expect(signature.h).toBeLessThanOrEqual(80);
  });

  it('rests both marks on the same baseline, so the two ruled lines stay level', async () => {
    const pdf = await generateConsultantContractPdf({
      ...base,
      signatureImagePng: dataUri(SIGNATURE),
      adminStampUrl: dataUri(STAMP),
    });
    const [, stamp, signature] = imagePlacements(pdf) as [Placement, Placement, Placement];

    // Bottom edges aligned: the taller stamp sets the band, the shorter
    // signature hangs from the bottom of it rather than floating above its line.
    expect(signature.bottom).toBeCloseTo(stamp.bottom, 3);
    expect(signature.top).toBeGreaterThan(stamp.top);
  });

});

describe('metworkLegalName', () => {
  it('adds the legal form to the bare party name', () => {
    // The party record is named "Metwork" for letterheads; a signature block
    // has to name the legal person.
    expect(metworkLegalName('Metwork')).toBe('EURL METWORK');
    expect(metworkLegalName('  metwork ')).toBe('EURL METWORK');
  });

  it('leaves a name that already carries one alone', () => {
    expect(metworkLegalName('EURL METWORK')).toBe('EURL METWORK');
    expect(metworkLegalName('eurl metwork')).toBe('EURL METWORK');
    expect(metworkLegalName('SARL Autre Chose')).toBe('SARL AUTRE CHOSE');
  });

  it('falls back when nothing is stored', () => {
    expect(metworkLegalName(null)).toBe('EURL METWORK');
    expect(metworkLegalName('')).toBe('EURL METWORK');
    expect(metworkLegalName(undefined)).toBe('EURL METWORK');
  });
});
