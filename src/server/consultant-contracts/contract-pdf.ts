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
  RULE,
  collectBuffer,
  fetchImageBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import { fontFor } from '@/server/pdf/fonts';

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
}

/* ─────────────────── Helpers ─────────────────── */

function setFont(doc: Doc, bold = false): Doc {
  return doc.font(fontFor({ bold }));
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

/** Height reserved for the two signature blocks, including their captions. */
const SIGNATURE_BLOCK_H = 190;

/**
 * The two signature blocks, side by side: the consultant's drawn signature on
 * the left, Metwork's stamp on the right.
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

  setFont(doc, true).fillColor(DARK).fontSize(10).text('Le consultant', MARGIN, top, { width: colW });
  setFont(doc, true).fillColor(DARK).fontSize(10).text(`Pour ${metworkName}`, rightX, top, { width: colW });

  const imgTop = top + 20;

  if (signature) {
    try {
      doc.image(signature, MARGIN, imgTop, { fit: [colW, IMG_H] });
    } catch {
      /* fall through to the ruled line below */
    }
  }
  if (stamp) {
    try {
      doc.image(stamp, rightX, imgTop, { fit: [colW, IMG_H] });
    } catch {
      /* fall through to the ruled line below */
    }
  }

  // Ruled lines under both, drawn whether or not an image landed — they frame
  // the images and stand in for them when one is missing.
  const lineY = imgTop + IMG_H + 6;
  doc.strokeColor(RULE).lineWidth(0.75);
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + colW, lineY).stroke();
  doc.moveTo(rightX, lineY).lineTo(rightX + colW, lineY).stroke();

  setFont(doc).fillColor(GRAY).fontSize(8.5);
  doc.text(`${input.consultantName}\nSigné le ${formatContractDateTime(input.signedAt)} (UTC)`, MARGIN, lineY + 6, {
    width: colW,
    lineGap: 1,
  });
  doc.text(`${metworkName}\nCachet de l'entreprise`, rightX, lineY + 6, {
    width: colW,
    lineGap: 1,
  });

  doc.y = lineY + 40;
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
  const signature = decodeDataUriPng(input.signatureImagePng);
  const stamp = await fetchImageBuffer(input.adminStampUrl);

  const doc = makeDoc();

  setFont(doc).fillColor('#27272a').fontSize(10.5).text(input.body || '', MARGIN, MARGIN, {
    width: CONTENT_W,
    align: 'justify',
    lineGap: 3,
  });

  drawSignatures(doc, signature, stamp, input);
  drawProvenanceFooter(doc, input);

  return collectBuffer(doc);
}
