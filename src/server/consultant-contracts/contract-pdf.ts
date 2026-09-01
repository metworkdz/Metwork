/**
 * Consultant contract PDF.
 *
 * French only — this is a legal instrument between EURL METWORK and one
 * consultant, and it is not translated. (The portal UI around it is still
 * localised; only the document is fixed.)
 *
 * Reuses the receipt generator's pdfkit primitives — page geometry, palette,
 * document lifecycle — so contracts share the platform's document stack
 * rather than starting a second one. The embedded DejaVu Serif face
 * registered by `makeDoc()` is what makes French typography (guillemets,
 * narrow no-break spaces, accented capitals) render correctly; the pdfkit
 * built-ins are CP1252-only and garble it.
 *
 * NOT to be confused with `src/server/contracts/contract-pdf.ts`, which renders
 * the incubator↔client space-booking contract. Different parties, different
 * document, no shared code beyond the receipt primitives both build on.
 *
 * THE ADMIN'S OWN TEMPLATE IS THE WHOLE DOCUMENT. This module used to also
 * auto-render a structured letterhead and a frozen-terms table above the
 * body — dropped deliberately: the admin's template already contains
 * whatever company identity and terms text they choose to write (optionally
 * via `{{tokens}}`, see `variables.ts`), and layering a second, independently
 * generated header on top of that produced literal duplicate RC/NIF lines.
 * What this module still owns is exactly what free text cannot express: the
 * drawn signature and stamp images, and the provenance footer.
 */
import type PDFDocument from 'pdfkit';
import {
  CONTENT_W,
  DARK,
  GRAY,
  INK,
  MARGIN,
  PAGE_H,
  PAGE_W,
  RULE,
  collectBuffer,
  fetchImageBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import { FONT } from '@/server/pdf/fonts';
import { splitAtSignatureMarker } from './variables';

type Doc = InstanceType<typeof PDFDocument>;

/* ─────────────────── Input ─────────────────── */

export interface ContractPdfInput {
  /** Contract id, printed only in the provenance footer. */
  contractId: string;
  consultantName: string;
  /**
   * Fully-merged French document text — the admin's own template with every
   * `{{token}}` already substituted (see `variables.ts`). Rendered verbatim,
   * top to bottom; this IS the document.
   */
  body: string;
  signerPhoneSnapshot: string;
  /** `data:image/png;base64,…` of the drawn signature. */
  signatureImagePng: string;
  signedAt: string;
  /** Metwork's stamp image. Null ⇒ the block prints without one. */
  adminStampUrl: string | null;
  /** Printed under Metwork's signature line. Defaults to 'EURL METWORK'. */
  metworkName?: string | null;
  /** Metwork's signatory, printed under its column. Defaults to the gérant. */
  metworkManager?: string | null;
  /**
   * DRAFT mode — the copy a consultant reads BEFORE signing.
   *
   * Renders the same body from the same frozen snapshot, but with empty
   * signature lines, no provenance footer, and a watermark on every page, so a
   * draft can never be mistaken for (or passed off as) the executed contract.
   */
  draft?: boolean;
}

/* ─────────────────── Helpers ─────────────────── */

/**
 * The contract is set in Times, matching the document the company already
 * issues. `FONT.serifTimes` is Tinos — metric-compatible with Times New Roman
 * and SIL-licensed; see the note in `@/server/pdf/fonts`.
 */
function setFont(doc: Doc, bold = false): Doc {
  return doc.font(bold ? FONT.serifTimesBold : FONT.serifTimes);
}

/** Type scale, as specified: 16pt title, 14pt article headings, 12pt body. */
const SIZE = { title: 16, subtitle: 14, heading: 14, body: 12 } as const;

/**
 * Is this body line an article heading?
 *
 * Matches "Article 3 — Commission" and the bare "ARTICLE 3 :" variants an admin
 * might type, in French or English. Kept deliberately narrow: a false positive
 * would set a whole paragraph at heading size, which is far more disfiguring
 * than a missed heading, so anything long or mid-sentence is left as body.
 */
export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  return /^(article|chapitre)\s+([0-9]{1,2}|premier|[ivxl]{1,5})\b/i.test(t);
}

/**
 * Timestamp as printed in the signature block.
 *
 * Exported for testing: with an embedded font, pdfkit writes text as glyph
 * indices rather than ASCII, so the rendered date cannot be asserted by reading
 * the PDF bytes. Testing the formatter directly is the only honest check.
 */
export function formatContractDateTime(iso: string): string {
  try {
    return new Date(iso)
      .toLocaleString('fr-DZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        // Explicit: Node's ICU resolves fr-DZ to a 12-hour clock, which would
        // print "02:32 PM" on a French legal document. Algeria uses 24-hour.
        hour12: false,
      })
      .replace(/ | /g, ' ');
  } catch {
    return iso;
  }
}

/**
 * Decode a `data:image/png;base64,…` payload into bytes pdfkit can draw.
 *
 * Returns null rather than throwing on anything malformed: a contract that
 * fails to render is a worse outcome than one whose signature block falls back
 * to a ruled line, and the signature is separately preserved on the record.
 */
export function decodeDataUriPng(dataUri: string): Buffer | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri ?? '');
  if (!match?.[1]) return null;
  try {
    const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
    // PNG magic number — guards against a base64 payload that decodes to
    // something pdfkit would choke on.
    const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return isPng ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * The metwork wordmark, read from the app's own asset rather than fetched.
 *
 * Cached after the first read: every contract renders the same mark, and a
 * disk hit per page would be wasted work. A missing file is not an error — the
 * letterhead simply omits the logo.
 */
let brandLogoCache: Buffer | null | undefined;
async function loadBrandLogo(): Promise<Buffer | null> {
  if (brandLogoCache !== undefined) return brandLogoCache;
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    // Read from src/server/pdf/assets, NOT public/. `public/` is served by the
    // CDN and is not present on the serverless filesystem, so the logo silently
    // vanished in production while working locally. The font directory next to
    // it is already proven to load there.
    brandLogoCache = await readFile(
      path.join(process.cwd(), 'src/server/pdf/assets/metwork-logo.png'),
    );
  } catch {
    brandLogoCache = null;
  }
  return brandLogoCache;
}

/** Logo box, top-right, mirroring the receipt letterhead's proportions. */
const LOGO_W = 132;
const LOGO_H = 28;

/**
 * Logo + centred title, drawn once at the top of page 1.
 *
 * The supplied contract template leads with the metwork wordmark top-right and
 * an underlined two-line title; reproducing it here is what makes a generated
 * contract look like the document the company already sends.
 */
function drawLetterhead(doc: Doc, logo: Buffer | null): void {
  if (logo) {
    try {
      doc.image(logo, PAGE_W - MARGIN - LOGO_W, MARGIN, { fit: [LOGO_W, LOGO_H], align: 'right' });
    } catch {
      /* a missing logo must never stop a contract rendering */
    }
  }
  doc.y = MARGIN + LOGO_H + 34;

  setFont(doc, true).fillColor(DARK).fontSize(SIZE.title)
    .text('CONTRAT DE PARTENARIAT', MARGIN, doc.y, { width: CONTENT_W, align: 'center', underline: true });
  doc.moveDown(0.35);
  setFont(doc, true).fillColor(DARK).fontSize(SIZE.subtitle)
    .text('ENTRE METWORK ET LE CONSULTANT / FORMATEUR', MARGIN, doc.y, {
      width: CONTENT_W, align: 'center', underline: true,
    });
  doc.moveDown(1.6);
}

/**
 * Diagonal "PROJET — NON SIGNÉ" wash on every page of a draft.
 *
 * Stamped in ONE pass at the end, over the buffered pages — never from a
 * `pageAdded` listener. That listener is what produced a 49-page contract from
 * a 3-page body: the watermark's own `doc.text()` could overflow, which adds a
 * page, which fires `pageAdded`, which draws again… Doing it after the body has
 * flowed means no content can be added while it runs, so re-entry is impossible.
 *
 * `lineBreak: false` and zeroed margins belt-and-brace it: the text is placed
 * absolutely and may never trigger pagination on its own.
 */
function drawDraftWatermark(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const { top, bottom } = doc.page.margins;
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;
    doc.save();
    doc.rotate(-38, { origin: [PAGE_W / 2, PAGE_H / 2] });
    setFont(doc, true).fillColor('#c9c9d0').fontSize(46).opacity(0.22)
      .text('PROJET — NON SIGNÉ', 0, PAGE_H / 2 - 26, {
        width: PAGE_W,
        align: 'center',
        lineBreak: false,
      });
    doc.opacity(1).restore();
    doc.page.margins.top = top;
    doc.page.margins.bottom = bottom;
  }
}

/**
 * "Page N / T" centred in the bottom margin of every page.
 *
 * The bottom margin is zeroed for the duration: writing below it makes pdfkit
 * auto-paginate, which silently appended a BLANK page and pushed the footer
 * onto it. `lineBreak: false` stops the same thing happening on overflow.
 */
function drawPageNumbers(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    setFont(doc).fillColor(GRAY).fontSize(8)
      .text(`Page ${i + 1} / ${range.count}`, MARGIN, PAGE_H - MARGIN + 16, {
        width: CONTENT_W,
        align: 'center',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}

/** Height reserved for the two signature blocks, including their captions. */
const SIGNATURE_BLOCK_H = 190;

/**
 * The two signature blocks, side by side.
 *
 * Column order follows the company's own contract template: METWORK on the
 * LEFT (stamp + gérant), the Consultant on the RIGHT. It used to be the other
 * way round, which put the wrong party under each caption.
 *
 * Moved to a fresh page when the remaining space cannot hold the whole block —
 * a signature stranded alone on a trailing page, or clipped at the margin, is
 * exactly the kind of defect that gets a document challenged.
 */
function drawSignatures(doc: Doc, signature: Buffer | null, stamp: Buffer | null, input: ContractPdfInput): void {
  if (doc.y + SIGNATURE_BLOCK_H > PAGE_H - MARGIN) doc.addPage();

  doc.moveDown(2);
  const top = doc.y;
  const colW = (CONTENT_W - 40) / 2;
  const rightX = MARGIN + colW + 40;
  const IMG_H = 80;
  const metworkName = input.metworkName?.trim() || 'EURL METWORK';
  const manager = input.metworkManager?.trim() || '';

  setFont(doc, true).fillColor(DARK).fontSize(10).text('Pour METWORK', MARGIN, top, { width: colW });
  setFont(doc, true).fillColor(DARK).fontSize(10).text('Pour le Consultant', rightX, top, { width: colW });

  const imgTop = top + 20;

  // Metwork's stamp (left) and the consultant's drawn signature (right).
  if (stamp) {
    try {
      doc.image(stamp, MARGIN, imgTop, { fit: [colW, IMG_H] });
    } catch {
      /* fall through to the ruled line below */
    }
  }
  if (signature) {
    try {
      doc.image(signature, rightX, imgTop, { fit: [colW, IMG_H] });
    } catch {
      /* fall through to the ruled line below */
    }
  }

  // Ruled lines under both, drawn whether or not an image landed — they frame
  // the images and stand in for them when one is missing (always, in a draft).
  const lineY = imgTop + IMG_H + 6;
  doc.strokeColor(RULE).lineWidth(0.75);
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + colW, lineY).stroke();
  doc.moveTo(rightX, lineY).lineTo(rightX + colW, lineY).stroke();

  // Captions mirror the company template: name, role, then what goes on the line.
  setFont(doc, true).fillColor(DARK).fontSize(9);
  doc.text(manager.toUpperCase() || metworkName, MARGIN, lineY + 6, { width: colW });
  doc.text(input.consultantName, rightX, lineY + 6, { width: colW });

  setFont(doc).fillColor(GRAY).fontSize(8.5);
  const roleY = doc.y;
  doc.text(`Gérant\nSignature et cachet :`, MARGIN, roleY, { width: colW, lineGap: 1 });
  doc.text(
    input.draft
      ? 'Consultant\nSignature :'
      : `Consultant\nSigné le ${formatContractDateTime(input.signedAt)} (UTC)`,
    rightX,
    roleY,
    { width: colW, lineGap: 1 },
  );

  doc.y = lineY + 46;
}

/**
 * Provenance footer.
 *
 * Records HOW the signature was obtained — drawn in-app, then confirmed by a
 * one-time code sent to the phone number frozen onto the contract. That
 * sentence is the difference between an image of a signature and an
 * attributable one, so it belongs in the document rather than only in the
 * database.
 *
 * The PDF's own SHA-256 is deliberately absent: it is computed over these
 * bytes, so it cannot be among them.
 */
function drawProvenanceFooter(doc: Doc, input: ContractPdfInput): void {
  const y = Math.min(doc.y + 10, PAGE_H - MARGIN - 46);
  setFont(doc).fillColor(GRAY).fontSize(7.5).text(
    `Document signé électroniquement. La signature manuscrite ci-dessus a été apposée par le consultant ` +
      `puis confirmée par un code à usage unique transmis au ${input.signerPhoneSnapshot}. ` +
      `Référence du contrat : ${input.contractId}.`,
    MARGIN,
    y,
    { width: CONTENT_W, lineGap: 1.5 },
  );
}

/* ─────────────────── Main ─────────────────── */

/**
 * Render the signed contract.
 *
 * Every value comes from the frozen contract record — nothing is read from
 * the live consultant or platform profile at render time, so re-rendering an
 * old contract years later produces the same document.
 */
export async function generateConsultantContractPdf(input: ContractPdfInput): Promise<Buffer> {
  // A draft has no signature or stamp to draw, whatever it was handed.
  const signature = input.draft ? null : decodeDataUriPng(input.signatureImagePng);
  const stamp = input.draft ? null : await fetchImageBuffer(input.adminStampUrl);
  const logo = await loadBrandLogo();

  // bufferPages: the "Page N / T" footer can only be written once the total
  // is known, i.e. after the whole body has flowed.
  const doc = makeDoc({ bufferPages: true });
  const [before, after] = splitAtSignatureMarker(input.body || '');

  drawLetterhead(doc, logo);
  const bodyTop = doc.y;

  const writeBody = (text: string, atTop: boolean): void => {
    if (!text) return;
    let first = true;
    // Rendered line-by-line rather than as one block so article headings can
    // carry their own size/weight. A single doc.text() call cannot mix them.
    for (const line of text.split('\n')) {
      const heading = isHeadingLine(line);
      setFont(doc, heading)
        .fillColor(heading ? DARK : INK)
        .fontSize(heading ? SIZE.heading : SIZE.body);
      const opts = {
        width: CONTENT_W,
        align: (heading ? 'left' : 'justify') as 'left' | 'justify',
        lineGap: heading ? 2 : 3,
      };
      // Only the very first line is positioned explicitly (just under the
      // title); everything after flows, including across the signature block.
      if (first && atTop) doc.text(line || ' ', MARGIN, bodyTop, opts);
      else doc.text(line || ' ', MARGIN, doc.y, opts);
      if (heading) doc.moveDown(0.15);
      first = false;
    }
  };

  writeBody(before, true);
  drawSignatures(doc, signature, stamp, input);
  // Text the admin placed AFTER the marker (annexes, extra clauses) follows the
  // block. Absent for the common case, where the marker ends the template or
  // isn't used at all.
  writeBody(after, false);
  // A draft carries no provenance line: nothing has been signed or attested yet.
  if (!input.draft) drawProvenanceFooter(doc, input);

  // Both of these write back over ALREADY-FLOWED pages, so they must come last:
  // the page total is only known now, and stamping the watermark here is what
  // makes it impossible for it to trigger pagination of its own.
  if (input.draft) drawDraftWatermark(doc);
  drawPageNumbers(doc);

  return collectBuffer(doc);
}
