/**
 * The signed cofounder agreement as a PDF — the same letterhead, body layout
 * and provenance line as consultant contracts, with the two founders'
 * signatures side by side. Rendered only from the frozen record.
 */
import {
  CONTENT_W,
  DARK,
  GRAY,
  MARGIN,
  PAGE_H,
  RULE,
  collectBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import { FONT } from '@/server/pdf/fonts';
import { drawContractLogo, drawPageNumbers, loadBrandLogo, typographyFor, writeContractBody } from '@/server/pdf/contract-layout';
import { decodeDataUriPng, formatContractDateTime } from '@/server/consultant-contracts/contract-pdf';
import { splitAtSignatureMarker } from '@/server/consultant-contracts/variables';

type Doc = ReturnType<typeof makeDoc>;

const IMG_H = 60;
const BLOCK_H = 150;

export interface AgreementSigner {
  name: string;
  signatureImagePng: string;
  signedAt: string;
  /** Masked phone, e.g. +213 5•• •• •• 12. */
  phone: string;
}

export interface AgreementPdfInput {
  agreementId: string;
  body: string;
  signers: [AgreementSigner, AgreementSigner];
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\s+/g, '');
  return digits.length > 6 ? `${digits.slice(0, 5)}•••••${digits.slice(-2)}` : '•••';
}

function drawSignatures(doc: Doc, signers: AgreementPdfInput['signers']): void {
  if (doc.y + BLOCK_H > PAGE_H - MARGIN) doc.addPage();
  doc.moveDown(2);
  const top = doc.y;
  const colW = (CONTENT_W - 40) / 2;
  signers.forEach((s, i) => {
    const x = MARGIN + i * (colW + 40);
    doc.font(FONT.serifTimesBold).fillColor(DARK).fontSize(10).text(`Fondateur ${i + 1}`, x, top, { width: colW });
    const img = decodeDataUriPng(s.signatureImagePng);
    if (img) {
      try { doc.image(img, x, top + 18, { fit: [colW, IMG_H], valign: 'bottom' }); } catch { /* the line stands in */ }
    }
    const lineY = top + 18 + IMG_H + 6;
    doc.strokeColor(RULE).lineWidth(0.75).moveTo(x, lineY).lineTo(x + colW, lineY).stroke();
    doc.font(FONT.serifTimesBold).fillColor(DARK).fontSize(9).text(s.name, x, lineY + 6, { width: colW });
    doc.font(FONT.serifTimes).fillColor(GRAY).fontSize(8.5).text(`Signé le ${formatContractDateTime(s.signedAt)} (UTC)`, x, doc.y, { width: colW });
  });
  doc.y = top + BLOCK_H - 20;
}

function drawProvenance(doc: Doc, input: AgreementPdfInput): void {
  const y = Math.min(doc.y + 10, PAGE_H - MARGIN - 46);
  doc.font(FONT.serifTimes).fillColor(GRAY).fontSize(7.5).text(
    `Document signé électroniquement sur Metwork. Chaque signature manuscrite a été apposée par son auteur puis confirmée ` +
      `par un code à usage unique : ${input.signers[0].name} au ${input.signers[0].phone}, ${input.signers[1].name} au ${input.signers[1].phone}. ` +
      `Référence de l'accord : ${input.agreementId}.`,
    MARGIN,
    y,
    { width: CONTENT_W, lineGap: 1.5 },
  );
}

export async function generateAgreementPdf(input: AgreementPdfInput): Promise<Buffer> {
  const doc = makeDoc({ bufferPages: true });
  drawContractLogo(doc, loadBrandLogo());
  const [before, after] = splitAtSignatureMarker(input.body);
  const typo = typographyFor(false);
  writeContractBody(doc, before, typo);
  drawSignatures(doc, input.signers);
  writeContractBody(doc, after, typo);
  drawProvenance(doc, input);
  drawPageNumbers(doc, FONT.serifTimes);
  return collectBuffer(doc);
}
