/**
 * Consultant contract PDF.
 *
 * French only — this is a legal instrument between EURL METWORK and one
 * consultant, and it is not translated. (The portal UI around it is still
 * localised; only the document is fixed.)
 *
 * Reuses the receipt generator's pdfkit primitives — page geometry, palette,
 * document lifecycle, remote image fetch — so contracts share the platform's
 * document stack rather than starting a second one. The embedded DejaVu Serif
 * face registered by `makeDoc()` is what makes French typography (guillemets,
 * narrow no-break spaces, accented capitals) render correctly; the pdfkit
 * built-ins are CP1252-only and garble it.
 *
 * NOT to be confused with `src/server/contracts/contract-pdf.ts`, which renders
 * the incubator↔client space-booking contract. Different parties, different
 * document, no shared code beyond the receipt primitives both build on.
 *
 * The layout is deliberately plain: a letterhead identifying the parties, the
 * body, an explicit terms table (the commission rate and payout route are the
 * substance of the agreement, so they are printed as facts, not left buried in
 * prose), and two signature blocks. Nothing decorative — the document exists to
 * be read by an auditor.
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
import { fontFor } from '@/server/pdf/fonts';
import type { ConsultantContractPayoutMethod, IncubatorRecord } from './types';

type Doc = InstanceType<typeof PDFDocument>;

/* ─────────────────── Copy (French, fixed) ─────────────────── */

const TITLE = 'CONTRAT DE MANDAT DE RECOUVREMENT';

const PAYOUT_LABELS: Record<ConsultantContractPayoutMethod, string> = {
  BANK_TRANSFER: 'Virement bancaire',
  CCP: 'Virement CCP (Algérie Poste)',
  CHEQUE: 'Chèque',
};

/* ─────────────────── Input ─────────────────── */

export interface ContractPdfInput {
  /** Metwork's legal identity — validated as complete before send. */
  metwork: Pick<
    IncubatorRecord,
    'name' | 'email' | 'phone' | 'logoUrl' | 'address' | 'commercialRegNumber' | 'registrationNumber' | 'nif'
  >;
  /** Contract id, printed as the reference. */
  contractId: string;
  consultantName: string;
  /** French body, `{{variables}}` already substituted. */
  body: string;
  /** Frozen terms, printed verbatim from the record — never re-derived. */
  commissionRate: number;
  payoutMethod: ConsultantContractPayoutMethod;
  payoutDetails: string | null;
  signerPhoneSnapshot: string;
  /** `data:image/png;base64,…` of the drawn signature. */
  signatureImagePng: string;
  signedAt: string;
  /** Metwork's stamp image. Null ⇒ the block prints without one. */
  adminStampUrl: string | null;
}

/* ─────────────────── Helpers ─────────────────── */

function setFont(doc: Doc, bold = false): Doc {
  return doc.font(fontFor({ bold }));
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-DZ', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso.slice(0, 10);
  }
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

/** "20 %" from 0.2, without floating-point noise. */
function fmtRate(rate: number): string {
  const pct = Math.round(rate * 1000) / 10;
  return `${pct.toString().replace('.', ',')} %`;
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

/** Letterhead: Metwork's legal block on the left, logo on the right. */
function drawLetterhead(doc: Doc, metwork: ContractPdfInput['metwork'], logo: Buffer | null): void {
  const startY = MARGIN;
  const LOGO_W = 140;
  const LOGO_H = 60;
  const GAP = 18;
  const infoW = logo ? CONTENT_W - LOGO_W - GAP : CONTENT_W;

  if (logo) {
    try {
      doc.image(logo, PAGE_W - MARGIN - LOGO_W, startY + 2, { fit: [LOGO_W, LOGO_H], align: 'right' });
    } catch {
      /* a broken logo must never fail the contract */
    }
  }

  setFont(doc, true).fillColor(DARK).fontSize(13).text(metwork.name || 'Metwork', MARGIN, startY, {
    width: infoW,
  });

  const rc = metwork.commercialRegNumber ?? metwork.registrationNumber ?? null;
  const lines = [
    rc ? `RC : ${rc}` : null,
    metwork.nif ? `NIF : ${metwork.nif}` : null,
    metwork.address ? `Adresse : ${metwork.address}` : null,
    metwork.phone ? `Tél : ${metwork.phone}` : null,
    metwork.email ? `Email : ${metwork.email}` : null,
  ].filter((l): l is string => l !== null);

  if (lines.length) {
    setFont(doc).fillColor('#3f3f46').fontSize(9.5).text(lines.join('\n'), MARGIN, doc.y + 2, {
      width: infoW,
      lineGap: 2,
    });
  }

  doc.y = Math.max(doc.y, logo ? startY + LOGO_H : startY);
  doc.moveDown(0.8);
  doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(RULE).lineWidth(1).stroke();
}

/** The frozen terms, printed as a two-column table. */
function drawTerms(doc: Doc, input: ContractPdfInput): void {
  const rows: Array<[string, string]> = [
    ['Consultant', input.consultantName],
    ['Commission Metwork', fmtRate(input.commissionRate)],
    ['Part reversée au consultant', fmtRate(1 - input.commissionRate)],
    ['Mode de règlement', PAYOUT_LABELS[input.payoutMethod]],
  ];
  if (input.payoutDetails) rows.push(['Coordonnées de règlement', input.payoutDetails]);
  rows.push(['Téléphone vérifié du signataire', input.signerPhoneSnapshot]);

  const LABEL_W = 200;
  const PAD = 7;

  for (const [label, value] of rows) {
    setFont(doc).fontSize(10);
    const valueW = CONTENT_W - LABEL_W;
    const height = Math.max(doc.heightOfString(value, { width: valueW }), doc.heightOfString(label, { width: LABEL_W })) + PAD * 2;

    // Keep a row whole rather than letting it straddle a page break.
    if (doc.y + height > PAGE_H - MARGIN - 40) doc.addPage();

    const top = doc.y;
    setFont(doc).fillColor(GRAY).fontSize(10).text(label, MARGIN, top + PAD, { width: LABEL_W });
    setFont(doc, true).fillColor(INK).fontSize(10).text(value, MARGIN + LABEL_W, top + PAD, { width: valueW });

    doc.y = top + height;
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
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

  setFont(doc, true).fillColor(DARK).fontSize(10).text('Le consultant', MARGIN, top, { width: colW });
  setFont(doc, true).fillColor(DARK).fontSize(10).text('Pour EURL METWORK', rightX, top, { width: colW });

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
  doc.text(`${input.metwork.name || 'EURL METWORK'}\nCachet de l'entreprise`, rightX, lineY + 6, {
    width: colW,
    lineGap: 1,
  });

  doc.y = lineY + 40;
}

/**
 * Provenance footer.
 *
 * Records HOW the signature was obtained — drawn in-app, then confirmed by a
 * one-time code sent to the phone number printed in the terms above. That
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
 * Every value printed comes from the frozen contract record — nothing is read
 * from the live consultant or platform profile at render time, so re-rendering
 * an old contract years later produces the same document.
 */
export async function generateConsultantContractPdf(input: ContractPdfInput): Promise<Buffer> {
  // Both fetches are null-safe; a missing image degrades the block, never the
  // document.
  const [logo, stamp] = await Promise.all([
    fetchImageBuffer(input.metwork.logoUrl),
    fetchImageBuffer(input.adminStampUrl),
  ]);
  const signature = decodeDataUriPng(input.signatureImagePng);

  const doc = makeDoc();

  drawLetterhead(doc, input.metwork, logo);

  doc.moveDown(1.4);
  setFont(doc, true).fillColor(DARK).fontSize(14).text(TITLE, MARGIN, doc.y, {
    width: CONTENT_W,
    align: 'center',
  });

  doc.moveDown(0.4);
  setFont(doc).fillColor(GRAY).fontSize(9).text(
    `Réf. ${input.contractId}  ·  Signé le ${fmtDate(input.signedAt)}`,
    MARGIN,
    doc.y,
    { width: CONTENT_W, align: 'center' },
  );

  doc.moveDown(1.4);
  setFont(doc).fillColor('#27272a').fontSize(10.5).text(input.body || '', MARGIN, doc.y, {
    width: CONTENT_W,
    align: 'justify',
    lineGap: 3,
  });

  doc.moveDown(1.6);
  setFont(doc, true).fillColor(DARK).fontSize(11).text('Conditions convenues', MARGIN, doc.y, {
    width: CONTENT_W,
  });
  doc.moveDown(0.5);
  drawTerms(doc, input);

  drawSignatures(doc, signature, stamp, input);
  drawProvenanceFooter(doc, input);

  return collectBuffer(doc);
}
