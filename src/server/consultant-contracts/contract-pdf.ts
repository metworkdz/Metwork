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
  MARGIN,
  PAGE_H,
  PAGE_W,
  RULE,
  collectBuffer,
  fetchImageBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import { FONT } from '@/server/pdf/fonts';
import {
  SIZE,
  drawContractLogo,
  drawPageNumbers,
  loadBrandLogo,
  typographyFor,
  writeContractBody,
} from '@/server/pdf/contract-layout';
import { splitAtSignatureMarker } from './variables';

/**
 * Re-exported: the space-rental contract and this one share one definition of
 * what a heading looks like, and callers of this module (tests included) should
 * not have to know which file it moved to.
 */
export { isHeadingLine } from '@/server/pdf/contract-layout';

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
 * Logo + centred title, drawn once at the top of page 1.
 *
 * The supplied contract template leads with the metwork wordmark top-right and
 * an underlined two-line title; reproducing it here is what makes a generated
 * contract look like the document the company already sends.
 */
function drawLetterhead(doc: Doc, logo: Buffer | null): void {
  drawContractLogo(doc, logo);
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
 * Image-box heights for the two columns.
 *
 * The company stamp is drawn half again as large as the consultant's
 * signature. It is a 632 × 455 px image, so pdfkit's `fit` scales it by HEIGHT
 * — 111 × 80 pt at `IMG_H` — and raising its box to 120 pt is therefore an
 * exact 1.5× in both directions. The resulting 166 pt still leaves ~55 pt of
 * clearance before the consultant's column, so the columns need no rebalancing.
 */
const IMG_H = 80;
const METWORK_IMG_H = 120;

/**
 * Vertical space the block needs, so it is never split across a page break.
 *
 * DERIVED from the parts it is built out of rather than typed as a number:
 * every one of these gaps is used again below, and a reservation that silently
 * stops matching the thing it reserves for is how a signature ends up stranded
 * on a trailing page.
 */
const SIG_LEAD_IN = 34;    // moveDown(2) above the block
const SIG_HEADING_H = 20;  // "Pour EURL METWORK" → top of the image band
const SIG_LINE_GAP = 6;    // image band → ruled line
const SIG_CAPTIONS_H = 46; // ruled line → end of the role captions
const SIGNATURE_BLOCK_H =
  SIG_LEAD_IN + SIG_HEADING_H + Math.max(IMG_H, METWORK_IMG_H) + SIG_LINE_GAP + SIG_CAPTIONS_H;

/**
 * Metwork's name with its legal form, for the column heading.
 *
 * The party record's `name` is just "Metwork" — enough for a letterhead, but a
 * signature block on a contract names the legal person. Rather than force the
 * record to be renamed everywhere it appears (receipts, invoices, emails), the
 * legal form is prepended here when the stored name doesn't already carry one.
 */
const LEGAL_FORM_RE = /^(EURL|SARL|SPA|SNC|SCS|SASU?|EPE|ETS|SPRL)\b/i;
export function metworkLegalName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim() || 'METWORK';
  return (LEGAL_FORM_RE.test(name) ? name : `EURL ${name}`).toUpperCase();
}

/**
 * Fallback signatory, used when no gérant is set under Platform Settings.
 *
 * Deliberately NOT the company name, which is what this used to fall back to:
 * printing "METWORK" above the caption "Gérant" states that the company is its
 * own manager, which is not a thing. A person signs; name the person.
 */
const DEFAULT_METWORK_MANAGER = 'Mohammed Benhamada';

/**
 * The two signature blocks, side by side.
 *
 * Column order follows the company's own contract template: METWORK on the
 * LEFT (stamp + gérant), the Consultant on the RIGHT. It used to be the other
 * way round, which put the wrong party under each caption.
 *
 * Both images are bottom-aligned within a band as tall as the LARGER of the
 * two, so the two ruled lines stay level with each other and each mark sits ON
 * its line rather than floating above it.
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
  const manager = input.metworkManager?.trim() || DEFAULT_METWORK_MANAGER;

  setFont(doc, true).fillColor(DARK).fontSize(10).text(`Pour ${metworkLegalName(input.metworkName)}`, MARGIN, top, { width: colW });
  setFont(doc, true).fillColor(DARK).fontSize(10).text('Pour le Consultant', rightX, top, { width: colW });

  const imgTop = top + SIG_HEADING_H;
  // The band is as tall as the taller image box; the shorter one hangs from its
  // bottom edge (`valign`), which is what keeps both marks on their own lines.
  const bandH = Math.max(IMG_H, METWORK_IMG_H);

  // Metwork's stamp (left) and the consultant's drawn signature (right).
  if (stamp) {
    try {
      doc.image(stamp, MARGIN, imgTop + bandH - METWORK_IMG_H, { fit: [colW, METWORK_IMG_H], valign: 'bottom' });
    } catch {
      /* fall through to the ruled line below */
    }
  }
  if (signature) {
    try {
      doc.image(signature, rightX, imgTop + bandH - IMG_H, { fit: [colW, IMG_H], valign: 'bottom' });
    } catch {
      /* fall through to the ruled line below */
    }
  }

  // Ruled lines under both, drawn whether or not an image landed — they frame
  // the images and stand in for them when one is missing (always, in a draft).
  const lineY = imgTop + bandH + SIG_LINE_GAP;
  doc.strokeColor(RULE).lineWidth(0.75);
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + colW, lineY).stroke();
  doc.moveTo(rightX, lineY).lineTo(rightX + colW, lineY).stroke();

  // Captions mirror the company template: name, role, then what goes on the line.
  setFont(doc, true).fillColor(DARK).fontSize(9);
  doc.text(manager, MARGIN, lineY + 6, { width: colW });
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

  doc.y = lineY + SIG_CAPTIONS_H;
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
  const logo = loadBrandLogo();

  // bufferPages: the "Page N / T" footer can only be written once the total
  // is known, i.e. after the whole body has flowed.
  const doc = makeDoc({ bufferPages: true });
  const [before, after] = splitAtSignatureMarker(input.body || '');

  drawLetterhead(doc, logo);
  const bodyTop = doc.y;

  const typo = typographyFor(false);
  const writeBody = (text: string, atTop: boolean): void =>
    writeContractBody(doc, text, typo, atTop ? { startY: bodyTop } : {});

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
  drawPageNumbers(doc, FONT.serifTimes);

  return collectBuffer(doc);
}
