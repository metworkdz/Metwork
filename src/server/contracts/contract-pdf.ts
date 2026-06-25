/**
 * Contract PDF generator.
 *
 * Renders a filled contract (variables already substituted upstream by the
 * variable engine) to an A4 PDF buffer, reusing the branded pdfkit primitives
 * from the receipt generator (same header band, logo handling, layout grid and
 * colour system) so contracts look like the rest of the platform's documents.
 *
 * Arabic ('ar') templates render right-to-left using an embedded Amiri TTF (a
 * traditional naskh face) — pdfkit/fontkit applies Arabic contextual shaping
 * and mark positioning (tashkeel/diacritics) automatically for embedded
 * OpenType fonts. The built-in Helvetica used for en/fr cannot render Arabic
 * glyphs, so every Arabic surface (header name, legal block, title, body) is
 * drawn with the embedded font instead.
 *
 * NOTE: Amiri was chosen over Noto Naskh Arabic specifically because Noto
 * Naskh's GPOS mark-anchor tables trigger a null-anchor crash in the bundled
 * fontkit when positioning diacritics; Amiri shapes the same text cleanly.
 */
import fs from 'node:fs';
import path from 'node:path';
import type PDFDocument from 'pdfkit';
import type { IncubatorRecord } from '@/server/db/store';
import {
  CONTENT_W,
  DARK,
  GRAY,
  GREEN,
  MARGIN,
  PAGE_H,
  PAGE_W,
  collectBuffer,
  drawHeader,
  drawIncubatorContact,
  fetchImageBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import type { ContractLang } from './variables';

/* ─────────────────── Embedded Arabic font ─────────────────── */

const ARABIC_FONT_PATH = path.join(
  process.cwd(),
  'src/server/contracts/fonts/Amiri-Regular.ttf',
);
const ARABIC_FONT = 'AmiriArabic';

/**
 * Read the bundled Arabic TTF once. Null-safe: if the file can't be read the
 * caller falls back to Helvetica (Arabic glyphs won't render, but generation
 * never crashes).
 */
let arabicFontBuffer: Buffer | null | undefined;
function loadArabicFont(): Buffer | null {
  if (arabicFontBuffer !== undefined) return arabicFontBuffer;
  try {
    arabicFontBuffer = fs.readFileSync(ARABIC_FONT_PATH);
  } catch {
    arabicFontBuffer = null;
  }
  return arabicFontBuffer;
}

/* ─────────────────── i18n labels ─────────────────── */

interface ContractLabels {
  title:     string;
  number:    string;
  issuedOn:  string;
  poweredBy: string;
}

const LABELS: Record<ContractLang, ContractLabels> = {
  en: { title: 'CONTRACT', number: 'Contract No.', issuedOn: 'Issued on',  poweredBy: 'Powered by Metwork' },
  fr: { title: 'CONTRAT',  number: 'Contrat N°',   issuedOn: 'Établi le',  poweredBy: 'Propulsé par Metwork' },
  ar: { title: 'عقد',      number: 'رقم العقد',     issuedOn: 'حرر في',     poweredBy: 'مُشغَّل بواسطة Metwork' },
};

/* ─────────────────── Input ─────────────────── */

export interface ContractPdfInput {
  incubator: Pick<
    IncubatorRecord,
    'name' | 'email' | 'phone' | 'city' | 'logoUrl' | 'address' | 'commercialRegNumber' | 'registrationNumber' | 'nif'
  >;
  lang: ContractLang;
  /** Unique contract number (from the variable engine). */
  contractNumber: string;
  /** Fully-rendered contract body — `{{tokens}}` already substituted. */
  body: string;
}

/* ─────────────────── Arabic-aware helpers ─────────────────── */

type Doc = InstanceType<typeof PDFDocument>;

// Arabic Unicode blocks (incl. presentation forms) — used to detect Arabic text
// in an otherwise-Latin (en/fr) contract body so Latin-only fonts don't garble
// an Arabic client name. Amiri covers both scripts.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
function hasArabic(s: string): boolean { return ARABIC_RE.test(s); }

/** Apply the right font for the language ('ar' → embedded Amiri, else Helvetica). */
function setFont(doc: Doc, lang: ContractLang, bold: boolean): void {
  if (lang === 'ar') {
    const buf = loadArabicFont();
    if (buf) {
      doc.font(ARABIC_FONT);
      return;
    }
  }
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
}

/**
 * Arabic header — green band + logo + RTL incubator name. Mirrors the receipt's
 * `drawHeader` visual but uses the embedded Arabic font, which Helvetica can't.
 */
function drawArabicHeader(doc: Doc, incubator: ContractPdfInput['incubator'], logoBuffer: Buffer | null): void {
  const HEADER_H = 90;
  doc.rect(0, 0, PAGE_W, HEADER_H).fill(GREEN);

  const LOGO_SIZE = 64;
  // Logo sits top-right for RTL.
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, PAGE_W - MARGIN - LOGO_SIZE, 13, {
        width: LOGO_SIZE, height: LOGO_SIZE, fit: [LOGO_SIZE, LOGO_SIZE], align: 'center', valign: 'center',
      });
    } catch { /* skip logo on error */ }
  }

  const textWidth = logoBuffer ? CONTENT_W - LOGO_SIZE - 16 : CONTENT_W;
  setFont(doc, 'ar', true);
  doc.fillColor('#ffffff').fontSize(18).text(incubator.name, MARGIN, 24, { width: textWidth, align: 'right', lineBreak: false });
  if (incubator.city) {
    doc.fillColor('#ffffff').fontSize(10).text(incubator.city, MARGIN, 50, { width: textWidth, align: 'right' });
  }
  doc.moveDown(0);
}

/** Legal block: address • phone • email • RC • NIF (richer than the receipt's). */
function drawLegalBlock(doc: Doc, incubator: ContractPdfInput['incubator'], lang: ContractLang): void {
  const isAr = lang === 'ar';
  const rcLabel  = isAr ? 'السجل التجاري' : 'RC';
  const nifLabel = isAr ? 'رقم التعريف الجبائي' : 'NIF';
  const cr  = incubator.commercialRegNumber ?? incubator.registrationNumber ?? null;

  const parts: string[] = [];
  if (incubator.address) parts.push(incubator.address);
  if (incubator.phone)   parts.push(incubator.phone);
  if (incubator.email)   parts.push(incubator.email);
  if (cr)                parts.push(`${rcLabel}: ${cr}`);
  if (incubator.nif)     parts.push(`${nifLabel}: ${incubator.nif}`);
  if (parts.length === 0) return;

  setFont(doc, lang, false);
  doc
    .fillColor(GRAY)
    .fontSize(9)
    .text(parts.join('  •  '), MARGIN, 100, { width: CONTENT_W, align: isAr ? 'right' : 'left' });
  doc.moveDown(0.5);
}

function drawDivider(doc: Doc): void {
  const y = doc.y + 6;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#e4e4e7').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

/* ─────────────────── Main ─────────────────── */

export async function generateContractPdf(input: ContractPdfInput): Promise<Buffer> {
  const { incubator, lang, contractNumber, body } = input;
  const isAr = lang === 'ar';
  const labels = LABELS[lang];
  const align: 'left' | 'right' = isAr ? 'right' : 'left';

  // Logo prefetch is non-blocking & null-safe (returns null on any error).
  const logoBuffer = await fetchImageBuffer(incubator.logoUrl);

  // Use the Arabic-capable font for the body when the template is Arabic OR the
  // resolved body contains Arabic characters (e.g. an Arabic client name inside
  // a French/English contract — common in Algeria). Amiri covers both scripts.
  const bodyArabic = isAr || hasArabic(body);

  const doc = makeDoc();
  // Register the Arabic font on this document (no-op fallback if unreadable).
  if (bodyArabic) {
    const buf = loadArabicFont();
    if (buf) {
      try { doc.registerFont(ARABIC_FONT, buf); } catch { /* fall back to Helvetica */ }
    }
  }

  // ── Header + legal block ──
  if (isAr) {
    drawArabicHeader(doc, incubator, logoBuffer);
  } else {
    drawHeader(doc, incubator, logoBuffer);
  }
  drawLegalBlock(doc, incubator, lang);

  // ── Title + contract number + date ──
  const todayStr = new Date().toLocaleDateString(
    lang === 'fr' ? 'fr-DZ' : lang === 'ar' ? 'ar-DZ' : 'en-GB',
    { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  doc.moveDown(0.8);
  setFont(doc, lang, true);
  doc.fillColor(DARK).fontSize(18).text(labels.title, MARGIN, doc.y, { width: CONTENT_W, align });
  doc.moveDown(0.3);
  setFont(doc, lang, false);
  doc
    .fillColor(GRAY)
    .fontSize(10)
    .text(`${labels.number} ${contractNumber}  ·  ${labels.issuedOn} ${todayStr}`, MARGIN, doc.y, {
      width: CONTENT_W,
      align,
    });
  drawDivider(doc);

  // ── Body (rendered template) ──
  doc.moveDown(0.4);
  if (bodyArabic && loadArabicFont()) doc.font(ARABIC_FONT);
  else setFont(doc, lang, false);
  doc
    .fillColor('#27272a')
    .fontSize(11)
    .text(body || '', MARGIN, doc.y, {
      width: CONTENT_W,
      align,
      // Arabic contextual shaping (joining forms) is applied automatically by
      // fontkit for embedded fonts. We deliberately do NOT pass explicit
      // OpenType `features` — forcing them engages GPOS mark/anchor lookups that
      // throw on some font/fontkit version combos.
      lineGap: 3,
    });

  // ── Footer note ──
  doc.moveDown(2);
  setFont(doc, lang, false);
  doc
    .fillColor(GRAY)
    .fontSize(8)
    .text(`© ${new Date().getFullYear()} ${incubator.name}  ·  ${labels.poweredBy}`, MARGIN, Math.min(doc.y, PAGE_H - 50), {
      width: CONTENT_W,
      align,
    });

  return collectBuffer(doc);
}
