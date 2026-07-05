/**
 * 'MINIMAL' invoice template — no color band, hairline #0D0D0D rules,
 * generous whitespace, letter-spaced small-caps section labels; color appears
 * only on the "Net à Payer" value (red, via the shared totals block).
 * Understated / elegant.
 */
import type { InvoiceViewModel } from '../viewModel';
import {
  BLACK, CONTENT_W, GRAY, MARGIN, PAGE_W,
  drawAmountInWords, drawBankLines, drawCancelledWatermark, drawContactFooter,
  drawLinesTable, drawTotalsBlock, sg,
  type Doc,
} from './shared';

/** Letter-spaced small-caps label. */
function capsLabel(doc: Doc, text: string, x: number, y: number, width?: number): void {
  sg(doc, { medium: true }).fillColor(GRAY).fontSize(8)
    .text(text.toUpperCase(), x, y, { characterSpacing: 1.6, width, lineBreak: false });
}

function hairline(doc: Doc, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(BLACK).stroke();
}

export function renderMinimal(doc: Doc, vm: InvoiceViewModel, logo: Buffer | null): void {
  const topY = MARGIN + 4;
  const LOGO_W = 110, LOGO_H = 46;

  // ── Header: logo left, "FACTURE" + meta right — lots of air ──
  if (logo) {
    try { doc.image(logo, MARGIN, topY, { fit: [LOGO_W, LOGO_H] }); } catch { /* skip */ }
  }
  sg(doc, { bold: true }).fillColor(BLACK).fontSize(22)
    .text('FACTURE', MARGIN, topY, { width: CONTENT_W, align: 'right', characterSpacing: 3 });
  sg(doc).fillColor(GRAY).fontSize(9.5)
    .text(`N° ${vm.number}   ·   ${vm.date}`, MARGIN, topY + 30, { width: CONTENT_W, align: 'right' });

  doc.y = Math.max(topY + LOGO_H, topY + 46) + 26;
  hairline(doc, doc.y);
  doc.y += 22;

  // ── Issuer / client, two airy columns ──
  const colW = CONTENT_W / 2 - 16;
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 16;
  const blocksTop = doc.y;

  capsLabel(doc, 'Émetteur', leftX, blocksTop);
  doc.y = blocksTop + 16;
  vm.issuerLines.forEach((line, i) => {
    sg(doc, i === 0 ? { medium: true, text: line } : { text: line })
      .fillColor(BLACK).fontSize(i === 0 ? 10.5 : 9)
      .text(line, leftX, doc.y, { width: colW, lineGap: 1 });
    doc.moveDown(0.18);
  });
  const leftBottom = doc.y;

  capsLabel(doc, 'Déstinataire', rightX, blocksTop);
  doc.y = blocksTop + 16;
  vm.clientLines.forEach((line, i) => {
    sg(doc, i === 0 ? { medium: true, text: line } : { text: line })
      .fillColor(BLACK).fontSize(i === 0 ? 10.5 : 9)
      .text(line, rightX, doc.y, { width: colW, lineGap: 1 });
    doc.moveDown(0.18);
  });
  doc.y = Math.max(leftBottom, doc.y) + 16;

  // ── Payment mode ──
  capsLabel(doc, 'Mode de paiement', MARGIN, doc.y);
  doc.y += 14;
  sg(doc).fillColor(BLACK).fontSize(10).text(vm.paymentLabel, MARGIN, doc.y);
  doc.y += 6;
  drawBankLines(doc, vm, MARGIN, GRAY);
  doc.y += 18;
  hairline(doc, doc.y);
  doc.y += 18;

  // ── Lines table — hairline rules only ──
  drawLinesTable(doc, vm, { headerColor: GRAY, headerRule: BLACK, rowRule: '#ececef' });
  doc.y += 16;

  drawTotalsBlock(doc, vm);
  doc.y += 18;

  drawAmountInWords(doc, vm);

  drawContactFooter(doc, vm, GRAY);
  drawCancelledWatermark(doc, vm);
}
