/**
 * Every face the PDF layer names must exist on disk.
 *
 * `registerPdfFonts` reads each TTF inside a try/catch and skips the ones it
 * cannot read, so a renamed, moved or forgotten file does not raise anything:
 * pdfkit simply falls back to Helvetica, which cannot even encode the no-break
 * space in "28 560,00 DA". The document still generates. It is just wrong, and
 * nobody finds out until someone looks at a printed invoice.
 *
 * That swallowing is deliberate — a missing font should not take down a
 * payment receipt — so this is the check that has to make up for it.
 *
 * (The files reach the serverless bundle on their own: nft resolves
 * `path.join(process.cwd(), 'src/server/pdf/fonts')` and traces the whole
 * directory. Verified by building with outputFileTracingIncludes set to {} —
 * see the note in next.config.mjs. Nothing needs listing per route.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { FONT, fontFor, invoiceFontFor } from '@/server/pdf/fonts';

const FONT_DIR = path.join(process.cwd(), 'src/server/pdf/fonts');

/** The filenames FILES maps to, read back out of the module source. */
function mappedFiles(): Record<string, string> {
  const source = fs.readFileSync(path.join(FONT_DIR, '..', 'fonts.ts'), 'utf8');
  const block = source.slice(source.indexOf('const FILES'), source.indexOf('/** Read + cache'));
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/\[FONT\.(\w+)\]:\s*'([^']+)'/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

describe('the embedded faces', () => {
  const files = mappedFiles();

  it('maps every registered face to a file', () => {
    expect(Object.keys(files).sort()).toEqual(Object.keys(FONT).sort());
  });

  it.each(Object.entries(mappedFiles()))('%s → %s exists and is a real TTF', (_key, file) => {
    const full = path.join(FONT_DIR, file);
    expect(fs.existsSync(full), `${file} is missing from src/server/pdf/fonts`).toBe(true);
    const head = fs.readFileSync(full).subarray(0, 4);
    // 0x00010000 — the TrueType version tag. A Git-LFS pointer or an HTML
    // error page saved by a failed download would sail past an existsSync.
    expect([...head], `${file} is not TrueType`).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it('carries a licence for every family it embeds', () => {
    const licences = fs.readdirSync(FONT_DIR).filter((f) => f.startsWith('LICENSE'));
    const families = new Set(
      Object.values(files).map((f) => f.split('-')[0]!.replace('.ttf', '')),
    );
    // DejaVu + Space Grotesk share LICENSE.txt; Tinos and Montserrat have
    // their own. What matters is that nothing is embedded unlicensed.
    expect(licences.length).toBeGreaterThanOrEqual(3);
    expect(families.size).toBe(5);
  });
});

describe('which face each document asks for', () => {
  it('sets invoices, proformas and devis in Montserrat', () => {
    expect(invoiceFontFor()).toBe(FONT.sans);
    expect(invoiceFontFor({ medium: true })).toBe(FONT.sansMedium);
    expect(invoiceFontFor({ bold: true })).toBe(FONT.sansBold);
  });

  it('sends Arabic to Amiri from both faces — nothing else covers the script', () => {
    expect(invoiceFontFor({ arabic: true, bold: true })).toBe(FONT.arabic);
    expect(fontFor({ arabic: true, bold: true })).toBe(FONT.arabic);
  });

  it('leaves receipts and contracts on their own faces', () => {
    expect(fontFor()).toBe(FONT.body);
    expect(fontFor({ bold: true })).toBe(FONT.bold);
  });
});
