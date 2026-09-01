/**
 * Embedded PDF fonts — the single place that registers the typefaces used by
 * every generated document (receipts, contracts, payment-link receipts, mentor
 * confirmations).
 *
 * WHY NOT the pdfkit built-ins (Helvetica/Times)? Those only encode WinAnsi
 * (CP1252). Real French text pasted from Word routinely contains characters
 * OUTSIDE that range — the narrow / thin no-break spaces (U+202F / U+2009) used
 * before « : ; ! ? » and inside numbers ("18 000"), plus the odd → № — which
 * pdfkit then renders as garbage glyphs ("18 /000", "paiement /:"). Embedding a
 * full Unicode TrueType font makes every character render correctly.
 *
 * Faces:
 *   • Body / Body-Bold / Body-Italic → DejaVu Serif (Bitstream Vera derivative,
 *     permissively licensed). Serif, so it matches the letterhead look of the
 *     official Metwork receipt template, and covers the full Latin + typographic
 *     range that broke Helvetica.
 *   • Arabic → Amiri (naskh). DejaVu doesn't shape Arabic; Amiri does, and it
 *     also covers Latin so an Arabic client name inside a French document works.
 */
import fs from 'node:fs';
import path from 'node:path';
import type PDFDocument from 'pdfkit';

type Doc = InstanceType<typeof PDFDocument>;

const FONT_DIR = path.join(process.cwd(), 'src/server/pdf/fonts');

/** Logical font names registered on every document. */
export const FONT = {
  body: 'Body',
  bold: 'Body-Bold',
  italic: 'Body-Italic',
  arabic: 'Arabic',
  /**
   * Tinos — metric-compatible with Times New Roman, SIL OFL. Used by the
   * consultant CONTRACT, which is a legal document the company issues in Times.
   * Not the Monotype original: that is licensed per-machine and cannot be
   * bundled into a repo or shipped to a server. Tinos matches its metrics and
   * shape, and unlike pdfkit's built-in Times it is a full Unicode face, so the
   * ● bullets and narrow no-break spaces in the contract template render.
   */
  serifTimes: 'Times',
  serifTimesBold: 'Times-Bold',
  serifTimesItalic: 'Times-Italic',
  /** Space Grotesk — brand face used by invoice PDFs (receipts keep DejaVu). */
  grotesk: 'Grotesk',
  groteskMedium: 'Grotesk-Medium',
  groteskBold: 'Grotesk-Bold',
} as const;

const FILES: Record<string, string> = {
  [FONT.body]: 'DejaVuSerif.ttf',
  [FONT.bold]: 'DejaVuSerif-Bold.ttf',
  [FONT.italic]: 'DejaVuSerif-Italic.ttf',
  [FONT.arabic]: 'Amiri-Regular.ttf',
  [FONT.serifTimes]: 'Tinos-Regular.ttf',
  [FONT.serifTimesBold]: 'Tinos-Bold.ttf',
  [FONT.serifTimesItalic]: 'Tinos-Italic.ttf',
  [FONT.grotesk]: 'SpaceGrotesk-Regular.ttf',
  [FONT.groteskMedium]: 'SpaceGrotesk-Medium.ttf',
  [FONT.groteskBold]: 'SpaceGrotesk-Bold.ttf',
};

/** Read + cache a font file once. Null-safe: a missing file just skips that face. */
const cache = new Map<string, Buffer | null>();
function load(name: string): Buffer | null {
  if (cache.has(name)) return cache.get(name)!;
  let buf: Buffer | null;
  try {
    buf = fs.readFileSync(path.join(FONT_DIR, FILES[name]!));
  } catch {
    buf = null;
  }
  cache.set(name, buf);
  return buf;
}

/**
 * Register the embedded faces on a document and make DejaVu Serif the default.
 * Call once, right after creating the doc. Any face that can't be read is
 * skipped (pdfkit keeps its built-in Helvetica as a last-resort fallback).
 */
export function registerPdfFonts(doc: Doc): void {
  for (const name of Object.values(FONT)) {
    const buf = load(name);
    if (buf) {
      try { doc.registerFont(name, buf); } catch { /* keep going */ }
    }
  }
  const bodyBuf = load(FONT.body);
  if (bodyBuf) {
    try { doc.font(FONT.body); } catch { /* fall back to Helvetica */ }
  }
}

/** True when the string contains any Arabic-script codepoint. */
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export function hasArabic(s: string): boolean {
  return ARABIC_RE.test(s);
}

/**
 * Font name for a given weight/style. When `arabic` is true (the text is Arabic
 * script) the Amiri face is used regardless of weight — it has a single weight
 * but covers everything and shapes correctly.
 */
export function fontFor(opts: { bold?: boolean; italic?: boolean; arabic?: boolean } = {}): string {
  if (opts.arabic) return FONT.arabic;
  if (opts.bold) return FONT.bold;
  if (opts.italic) return FONT.italic;
  return FONT.body;
}

/**
 * Invoice face (Space Grotesk). Arabic text (e.g. a client name) falls back to
 * Amiri — Grotesk has no Arabic coverage.
 */
export function invoiceFontFor(opts: { bold?: boolean; medium?: boolean; arabic?: boolean } = {}): string {
  if (opts.arabic) return FONT.arabic;
  if (opts.bold) return FONT.groteskBold;
  if (opts.medium) return FONT.groteskMedium;
  return FONT.grotesk;
}
