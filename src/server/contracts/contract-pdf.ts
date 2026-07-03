/**
 * Contract PDF generator.
 *
 * Renders a filled contract (variables already substituted upstream by the
 * variable engine) to an A4 PDF buffer. Letterhead style (no coloured banner):
 *   ┌───────────────────────────────────────────────┐
 *   │ Company info block (name + RC/NIF/…)   [ LOGO ]│
 *   │                                                │
 *   │            CONTRACT TITLE (centered)           │
 *   │              N° … · issued on …                │
 *   │                                                │
 *   │  body …                                        │
 *   └───────────────────────────────────────────────┘
 * Reuses the receipt generator's pdfkit primitives (page geometry, colours,
 * logo fetch, doc lifecycle) so contracts share the platform's document stack.
 *
 * Arabic ('ar') templates render right-to-left using an embedded Amiri TTF (a
 * traditional naskh face) — pdfkit/fontkit applies Arabic contextual shaping
 * and mark positioning (tashkeel/diacritics) automatically for embedded
 * OpenType fonts. The built-in Helvetica used for en/fr cannot render Arabic
 * glyphs, so any Arabic surface (company name, body) is drawn with the embedded
 * font instead. Amiri also covers Latin, so an Arabic client name inside an
 * en/fr contract still renders.
 *
 * NOTE: Amiri was chosen over Noto Naskh Arabic specifically because Noto
 * Naskh's GPOS mark-anchor tables trigger a null-anchor crash in the bundled
 * fontkit when positioning diacritics; Amiri shapes the same text cleanly.
 */
import type PDFDocument from 'pdfkit';
import type { IncubatorRecord } from '@/server/db/store';
import {
  CONTENT_W,
  DARK,
  GRAY,
  MARGIN,
  PAGE_H,
  PAGE_W,
  collectBuffer,
  fetchImageBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import { fontFor, hasArabic } from '@/server/pdf/fonts';
import type { ContractLang } from './variables';

/* ─────────────────── i18n labels ─────────────────── */

interface ContractLabels {
  title:     string;
  number:    string;
  issuedOn:  string;
  poweredBy: string;
}

const LABELS: Record<ContractLang, ContractLabels> = {
  en: { title: 'CONTRACT', number: 'No.',       issuedOn: 'Issued on',  poweredBy: 'Powered by Metwork' },
  fr: { title: 'CONTRAT',  number: 'N°',        issuedOn: 'Établi le',  poweredBy: 'Propulsé par Metwork' },
  ar: { title: 'عقد',      number: 'رقم',       issuedOn: 'حرر في',     poweredBy: 'مُشغَّل بواسطة Metwork' },
};

/** Company-info line labels (letterhead block). */
const INFO_LABELS: Record<ContractLang, { rc: string; nif: string; address: string; phone: string; email: string }> = {
  en: { rc: 'RC', nif: 'NIF', address: 'Address', phone: 'Phone', email: 'Email' },
  fr: { rc: 'RC', nif: 'NIF', address: 'Adresse', phone: 'Tél',   email: 'Email' },
  ar: { rc: 'السجل التجاري', nif: 'رقم التعريف الجبائي', address: 'العنوان', phone: 'الهاتف', email: 'البريد الإلكتروني' },
};

/* ─────────────────── Input ─────────────────── */

export interface ContractPdfInput {
  incubator: Pick<
    IncubatorRecord,
    'name' | 'email' | 'phone' | 'city' | 'logoUrl' | 'address' | 'commercialRegNumber' | 'registrationNumber' | 'nif'
  >;
  lang: ContractLang;
  /** Displayed contract title (the template name). Falls back to a generic word. */
  title?: string;
  /** Unique contract number (from the variable engine). */
  contractNumber: string;
  /** Fully-rendered contract body — `{{tokens}}` already substituted. */
  body: string;
}

/* ─────────────────── Helpers ─────────────────── */

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Apply the right embedded font. Arabic templates use Amiri (naskh shaping);
 * Latin (en/fr) uses the embedded DejaVu Serif — NOT the pdfkit built-in
 * Helvetica, whose CP1252-only encoding garbles the narrow/thin no-break spaces
 * and typographic marks that French contract text pasted from Word is full of.
 */
function setFont(doc: Doc, lang: ContractLang, bold: boolean): void {
  doc.font(fontFor({ bold, arabic: lang === 'ar' }));
}

/**
 * Letterhead header: company-info block on the leading side and a large logo on
 * the trailing side (mirrored for RTL). No coloured banner. Leaves `doc.y` just
 * below the taller of the two columns.
 */
function drawContractHeader(doc: Doc, incubator: ContractPdfInput['incubator'], logoBuffer: Buffer | null, lang: ContractLang): void {
  const isAr = lang === 'ar';
  const al: 'left' | 'right' = isAr ? 'right' : 'left';
  const startY = MARGIN;

  const LOGO_W = 150;
  const LOGO_H = 72;
  const GAP = 20;
  const hasLogo = !!logoBuffer;

  const companyW = hasLogo ? CONTENT_W - LOGO_W - GAP : CONTENT_W;
  const companyX = isAr && hasLogo ? MARGIN + LOGO_W + GAP : MARGIN;
  const logoX = isAr ? MARGIN : PAGE_W - MARGIN - LOGO_W;

  // Logo (larger than a corner icon; aspect preserved within the box). pdfkit
  // only supports align right/center inside the fit box — for LTR we right-align
  // it to hug the right margin; for RTL the default (top-left) hugs the left.
  if (hasLogo) {
    try {
      doc.image(
        logoBuffer as Buffer,
        logoX,
        startY,
        isAr ? { fit: [LOGO_W, LOGO_H] } : { fit: [LOGO_W, LOGO_H], align: 'right' },
      );
    } catch { /* skip logo on error */ }
  }

  // Company name (bold).
  setFont(doc, lang, true);
  doc.fillColor(DARK).fontSize(13).text(incubator.name || '', companyX, startY, { width: companyW, align: al });

  // Legal / contact lines.
  const L = INFO_LABELS[lang];
  const cr = incubator.commercialRegNumber ?? incubator.registrationNumber ?? null;
  const lines: string[] = [];
  if (cr)                lines.push(`${L.rc} : ${cr}`);
  if (incubator.nif)     lines.push(`${L.nif} : ${incubator.nif}`);
  if (incubator.address) lines.push(`${L.address} : ${incubator.address}`);
  if (incubator.phone)   lines.push(`${L.phone} : ${incubator.phone}`);
  if (incubator.email)   lines.push(`${L.email} : ${incubator.email}`);
  if (lines.length) {
    setFont(doc, lang, false);
    doc.fillColor('#3f3f46').fontSize(9.5).text(lines.join('\n'), companyX, doc.y + 2, { width: companyW, align: al, lineGap: 2 });
  }

  // Advance below the taller of the company block / logo.
  const companyBottom = doc.y;
  const logoBottom = hasLogo ? startY + LOGO_H : startY;
  doc.y = Math.max(companyBottom, logoBottom);
}

/* ─────────────────── Main ─────────────────── */

export async function generateContractPdf(input: ContractPdfInput): Promise<Buffer> {
  const { incubator, lang, contractNumber, body, title } = input;
  const isAr = lang === 'ar';
  const labels = LABELS[lang];
  const align: 'left' | 'right' = isAr ? 'right' : 'left';

  // Logo prefetch is non-blocking & null-safe (returns null on any error).
  const logoBuffer = await fetchImageBuffer(incubator.logoUrl);

  // Use the Arabic-capable font for the body when the template is Arabic OR the
  // resolved body contains Arabic characters (e.g. an Arabic client name inside
  // a French/English contract — common in Algeria). Amiri covers both scripts.
  const bodyArabic = isAr || hasArabic(body);

  // makeDoc() already registers every embedded face (DejaVu Serif + Amiri).
  const doc = makeDoc();

  // ── Letterhead header (company info + logo) ──
  drawContractHeader(doc, incubator, logoBuffer, lang);

  // ── Title (centered, underlined) + contract number / date ──
  const todayStr = new Date().toLocaleDateString(
    lang === 'fr' ? 'fr-DZ' : lang === 'ar' ? 'ar-DZ' : 'en-GB',
    { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  const rawTitle = (title && title.trim()) || labels.title;
  const displayTitle = isAr ? rawTitle : rawTitle.toUpperCase();

  doc.moveDown(1.6);
  setFont(doc, lang, true);
  doc.fillColor(DARK).fontSize(15).text(displayTitle, MARGIN, doc.y, { width: CONTENT_W, align: 'center', underline: true });

  doc.moveDown(0.4);
  setFont(doc, lang, false);
  doc
    .fillColor(GRAY)
    .fontSize(9)
    .text(`${labels.number} ${contractNumber}  ·  ${labels.issuedOn} ${todayStr}`, MARGIN, doc.y, {
      width: CONTENT_W,
      align: 'center',
      underline: false,
    });

  // ── Body (rendered template) ──
  doc.moveDown(1.6);
  doc.font(fontFor({ arabic: bodyArabic }));
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
