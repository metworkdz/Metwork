/**
 * 'GREEN_BAND' invoice template — same content/structure as CLASSIC but with a
 * full-width #30a735 header band (logo + "FACTURE" reversed in white), a
 * monochrome body and green rule accents. Premium, minimal.
 */
import type { InvoiceViewModel } from '../viewModel';
import {
  BLACK, CONTENT_W, GRAY, GREEN, MARGIN, PAGE_W,
  drawAmountInWords, drawBankLines, drawCancelledWatermark, drawContactFooter,
  drawLinesTable, drawTotalsBlock, sg,
  type Doc,
} from './shared';

export function renderGreenBand(doc: Doc, vm: InvoiceViewModel, logo: Buffer | null): void {
  // ── Full-width brand band ──
  const BAND_H = 92;
  doc.rect(0, 0, PAGE_W, BAND_H).fill(GREEN);

  const LOGO_W = 120, LOGO_H = 50;
  if (logo) {
    try { doc.image(logo, MARGIN, (BAND_H - LOGO_H) / 2, { fit: [LOGO_W, LOGO_H] }); } catch { /* skip */ }
  }
  sg(doc, { bold: true }).fillColor('#ffffff').fontSize(26)
    .text('FACTURE', MARGIN, BAND_H / 2 - 16, { width: CONTENT_W, align: 'right' });
  sg(doc).fillColor('#ffffff').fontSize(9.5)
    .text(`N° ${vm.number}  ·  ${vm.date}`, MARGIN, BAND_H / 2 + 14, { width: CONTENT_W, align: 'right' });

  doc.y = BAND_H + 26;

  // ── Issuer (left) · Déstinataire (right) ──
  const colW = CONTENT_W / 2 - 12;
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 12;
  const blocksTop = doc.y;

  sg(doc, { medium: true }).fillColor(GRAY).fontSize(8.5).text('ÉMETTEUR', leftX, blocksTop);
  doc.y = blocksTop + 13;
  vm.issuerLines.forEach((line, i) => {
    sg(doc, i === 0 ? { bold: true, text: line } : { text: line })
      .fillColor(BLACK).fontSize(i === 0 ? 11 : 9)
      .text(line, leftX, doc.y, { width: colW });
    doc.moveDown(0.12);
  });
  const leftBottom = doc.y;

  sg(doc, { medium: true }).fillColor(GRAY).fontSize(8.5).text('DÉSTINATAIRE', rightX, blocksTop);
  doc.y = blocksTop + 13;
  vm.clientLines.forEach((line, i) => {
    sg(doc, i === 0 ? { bold: true, text: line } : { text: line })
      .fillColor(BLACK).fontSize(i === 0 ? 11 : 9)
      .text(line, rightX, doc.y, { width: colW });
    doc.moveDown(0.12);
  });
  doc.y = Math.max(leftBottom, doc.y) + 12;

  // ── Payment mode + green accent rule ──
  sg(doc, { medium: true }).fillColor(BLACK).fontSize(10)
    .text('Mode de Paiement', MARGIN, doc.y, { continued: true })
    .text('   ', { continued: true });
  sg(doc).fillColor(BLACK).text(vm.paymentLabel);
  doc.y += 4;
  drawBankLines(doc, vm, MARGIN, BLACK);
  doc.y += 8;
  doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).lineWidth(1.4).strokeColor(GREEN).stroke();
  doc.y += 14;

  // ── Lines table (monochrome, green header rule) ──
  drawLinesTable(doc, vm, { headerColor: BLACK, headerRule: GREEN, rowRule: '#e4e4e8' });
  doc.y += 10;

  drawTotalsBlock(doc, vm);
  doc.y += 14;

  drawAmountInWords(doc, vm);

  drawContactFooter(doc, vm, GRAY);
  drawCancelledWatermark(doc, vm);
}
