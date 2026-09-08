/**
 * Shared layout for every contract the platform issues.
 *
 * Two documents are rendered from an admin-written template — the consultant
 * partnership contract (`src/server/consultant-contracts/contract-pdf.ts`) and
 * the space-rental contract (`src/server/contracts/contract-pdf.ts`) — and they
 * are meant to look like they came out of the same office: same wordmark in the
 * same corner, same Times body, same heading scale, same page numbering. That
 * only stays true if there is ONE implementation of it, which is this file.
 *
 * What deliberately does NOT live here: anything either document owns alone —
 * the consultant contract's signature block, draft watermark and provenance
 * footer, and the space contract's title/number line. Sharing those would mean
 * a change made for one document silently editing the other.
 */
import type PDFDocument from 'pdfkit';
import { CONTENT_W, DARK, GRAY, INK, MARGIN, PAGE_H, PAGE_W } from '@/server/notifications/receipt';
import { FONT } from '@/server/pdf/fonts';
import { METWORK_LOGO_PNG_BASE64 } from '@/server/pdf/assets/metwork-logo';

type Doc = InstanceType<typeof PDFDocument>;

/** Type scale, as specified: 16pt title, 14pt article headings, 12pt body. */
export const SIZE = { title: 16, subtitle: 14, heading: 14, body: 12 } as const;

/* ─────────────────── Typography ─────────────────── */

/**
 * The faces a contract is set in.
 *
 * Times (Tinos) for Latin contracts, Amiri for Arabic ones — Tinos has no
 * Arabic coverage at all, so an `ar` template set in it would render nothing.
 * Amiri has a single weight, so bold and regular resolve to the same face and
 * headings are distinguished by size alone.
 */
export interface ContractTypography {
  regular: string;
  bold: string;
  /** Body alignment. Arabic contracts set right; everything else justifies. */
  align: 'justify' | 'right';
  /** True for right-to-left, which mirrors the bullet hanging indent. */
  rtl: boolean;
}

export function typographyFor(arabic: boolean): ContractTypography {
  return arabic
    ? { regular: FONT.arabic, bold: FONT.arabic, align: 'right', rtl: true }
    : { regular: FONT.serifTimes, bold: FONT.serifTimesBold, align: 'justify', rtl: false };
}

/* ─────────────────── Heading detection ─────────────────── */

/** Is every letter in the string a capital? (Accent-aware, via locale casing.) */
function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return false;
  return letters === letters.toLocaleUpperCase('fr');
}

/**
 * Is this body line a section heading?
 *
 * Recognises the three forms the platform's own templates actually use:
 *   • "Article 3 — Commission" / "ARTICLE 3 :" / "Chapitre 2 — …"
 *   • "1. OBJET DU CONTRAT" — numbered AND set in capitals
 *
 * Kept deliberately narrow. A false positive sets a whole paragraph at heading
 * size, which is far more disfiguring than a missed heading, so anything long
 * or mid-sentence is left as body — and a numbered line only counts when it is
 * capitalised, which is what separates a heading from the first item of an
 * ordinary numbered list.
 */
export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^(article|chapitre)\s+([0-9]{1,2}|premier|[ivxl]{1,5})\b/i.test(t)) return true;
  const numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(t);
  return numbered ? isAllCaps(numbered[1]!) : false;
}

/**
 * Is this line a sub-heading — "4.1 – Responsabilité du Locataire"?
 *
 * Set bold at body size rather than at heading size: it is a subdivision of the
 * article above it, and giving it the same weight as the article would flatten
 * the structure the numbering is there to express.
 *
 * The character after the number must be a dash or a capital, so a figure in
 * running prose ("2.5 % de commission") is never promoted.
 */
export function isSubHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  return /^\d{1,2}\.\d{1,2}(\s*[–—-]\s*|\s+)\p{Lu}/u.test(t);
}

/* ─────────────────── Brand mark ─────────────────── */

/** Logo box, top-right, mirroring the receipt letterhead's proportions. */
export const LOGO_W = 132;
export const LOGO_H = 28;

/**
 * The metwork wordmark.
 *
 * Decoded from a source constant, NOT read from disk. Reading it failed in
 * production from both `public/assets/` and `src/server/pdf/assets/`: the path
 * is built from `process.cwd()`, which Next's file tracer cannot analyse, so
 * the PNG was never bundled into the lambda and the logo silently disappeared
 * while working perfectly in dev. See the note in `./assets/metwork-logo`.
 *
 * Cached after the first decode — every contract draws the same mark.
 */
let brandLogoCache: Buffer | null | undefined;
export function loadBrandLogo(): Buffer | null {
  if (brandLogoCache !== undefined) return brandLogoCache;
  try {
    const buf = Buffer.from(METWORK_LOGO_PNG_BASE64, 'base64');
    // Guard the magic number: a truncated constant must degrade to "no logo"
    // rather than make pdfkit throw and take the whole contract down.
    const isPng =
      buf.length > 8 &&
      buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    brandLogoCache = isPng ? buf : null;
  } catch {
    brandLogoCache = null;
  }
  return brandLogoCache;
}

/**
 * Draw the letterhead logo in the top-right corner and leave `doc.y` below it.
 *
 * A missing or unreadable logo must never stop a contract rendering, so the
 * draw is guarded and the vertical advance happens either way — a document
 * with no mark still starts its title in the same place.
 */
export function drawContractLogo(doc: Doc, logo: Buffer | null): void {
  if (logo) {
    try {
      doc.image(logo, PAGE_W - MARGIN - LOGO_W, MARGIN, { fit: [LOGO_W, LOGO_H], align: 'right' });
    } catch {
      /* a missing logo must never stop a contract rendering */
    }
  }
  doc.y = MARGIN + LOGO_H + 34;
}

/* ─────────────────── Page numbers ─────────────────── */

/**
 * "Page N / T" centred in the bottom margin of every page.
 *
 * Must run AFTER the whole body has flowed — the total is only known then —
 * which is why the caller creates the document with `bufferPages: true`.
 *
 * The bottom margin is zeroed for the duration: writing below it makes pdfkit
 * auto-paginate, which silently appended a BLANK page and pushed the footer
 * onto it. `lineBreak: false` stops the same thing happening on overflow.
 */
export function drawPageNumbers(doc: Doc, font: string): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(font).fillColor(GRAY).fontSize(8)
      .text(`Page ${i + 1} / ${range.count}`, MARGIN, PAGE_H - MARGIN + 16, {
        width: CONTENT_W,
        align: 'center',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}

/* ─────────────────── Body ─────────────────── */

/** Bullet characters the platform's templates use, plus the usual dashes. */
const BULLET_RE = /^\s*([•●▪◦*]|[-–—])\s+(.*)$/;
/** Hanging indent for a bullet's continuation lines. */
const BULLET_INDENT = 14;

/**
 * Render the contract body, line by line.
 *
 * Line-by-line rather than one `doc.text()` call because a single call cannot
 * mix sizes and weights, and headings have to carry their own.
 *
 * Tabs are replaced with a space. Templates pasted from Word write their
 * bullets as "•⇥text", and a TAB has no glyph in an embedded TrueType font —
 * it resolves to .notdef, so the bullet's text either butts up against the dot
 * or draws a replacement box. The bullet is instead drawn in its own column
 * with the text hanging beside it, so a wrapped bullet lines up under its own
 * first word rather than under the dot.
 */
export function writeContractBody(
  doc: Doc,
  text: string,
  typo: ContractTypography,
  opts: { startY?: number } = {},
): void {
  if (!text) return;
  let first = true;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\t/g, ' ');
    const heading = isHeadingLine(line);
    const sub = !heading && isSubHeadingLine(line);
    const bullet = !heading && !sub ? BULLET_RE.exec(line) : null;

    doc.font(heading || sub ? typo.bold : typo.regular)
      .fillColor(heading ? DARK : INK)
      .fontSize(heading ? SIZE.heading : SIZE.body);

    // Only the very first line may be positioned explicitly (just under the
    // title); everything after it flows.
    const y = first && opts.startY != null ? opts.startY : doc.y;
    first = false;

    if (bullet) {
      // Keep the mark and its text on the same page: drawing the mark first
      // can itself trigger pagination, which would strand it on its own.
      doc.y = y;
      if (doc.y + doc.currentLineHeight(true) > PAGE_H - MARGIN) doc.addPage();
      const markY = doc.y;
      const textW = CONTENT_W - BULLET_INDENT;
      const markX = typo.rtl ? PAGE_W - MARGIN - BULLET_INDENT : MARGIN;
      const textX = typo.rtl ? MARGIN : MARGIN + BULLET_INDENT;
      doc.text(bullet[1]!, markX, markY, { width: BULLET_INDENT, lineBreak: false });
      doc.text(bullet[2]! || ' ', textX, markY, {
        width: textW,
        align: typo.align,
        lineGap: 3,
      });
      continue;
    }

    doc.text(line || ' ', MARGIN, y, {
      width: CONTENT_W,
      align: heading || sub ? (typo.rtl ? 'right' : 'left') : typo.align,
      lineGap: heading || sub ? 2 : 3,
    });
    if (heading) doc.moveDown(0.15);
  }
}
