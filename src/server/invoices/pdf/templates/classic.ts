/**
 * 'CLASSIC' invoice template — replicates the official Metwork reference
 * invoice: logo top-left; issuer legal block top-right (left-aligned text);
 * centered "FACTURE" with a thin rule through it; "Déstinataire" client block;
 * "Mode de Paiement" left with Numero/DATE beside it; the lines table indented
 * to the center-right; right-aligned totals (timbre only for Espèce, Net à
 * Payer in red); bank details for Virement; amount in words pinned
 * bottom-left; icon contact footer.
 */
import type { InvoiceViewModel } from '../viewModel';
import {
  BLACK, CONTENT_W, DARK_GREEN, GRAY, MARGIN, PAGE_W,
  drawAmountInWords, drawBankLines, drawCancelledWatermark, drawContactFooter,
  drawLinesTable, drawTotalsBlock, sg,
  type Doc,
} from './shared';

/** Left edge of the meta column + table, matching the reference's indent. */
const TABLE_X = MARGIN + 135;

export function renderClassic(doc: Doc, vm: InvoiceViewModel, logo: Buffer | null): void {
  const topY = MARGIN;
  const LOGO_W = 165, LOGO_H = 64;

  // ── Header: logo left · issuer legal block right (left-aligned text) ──
  if (logo) {
    try { doc.image(logo, MARGIN, topY, { fit: [LOGO_W, LOGO_H] }); } catch { /* skip */ }
  }
  const blockW = 235;
  const blockX = PAGE_W - MARGIN - blockW;
  doc.y = topY;
  vm.issuerLines.forEach((line, i) => {
    sg(doc, i === 0 ? { medium: true, text: line } : { text: line })
      .fillColor(BLACK).fontSize(10)
      .text(line, blockX, doc.y, { width: blockW, lineGap: 1.5 });
    doc.moveDown(0.1);
  });
  doc.y = Math.max(doc.y, logo ? topY + LOGO_H : doc.y) + 26;

  // ── Centered "FACTURE" with a thin rule through it ──
  const title = 'FACTURE';
  sg(doc, { bold: true }).fontSize(24);
  const tw = doc.widthOfString(title);
  const ty = doc.y;
  const midY = ty + 12;
  doc.moveTo(MARGIN, midY).lineTo(PAGE_W / 2 - tw / 2 - 10, midY).lineWidth(0.7).strokeColor(GRAY).stroke();
  doc.moveTo(PAGE_W / 2 + tw / 2 + 10, midY).lineTo(PAGE_W - MARGIN, midY).lineWidth(0.7).strokeColor(GRAY).stroke();
  sg(doc, { bold: true }).fillColor(BLACK).fontSize(24)
    .text(title, MARGIN, ty, { width: CONTENT_W, align: 'center' });
  doc.y = ty + 42;

  // ── Déstinataire (left) ──
  sg(doc, { medium: true }).fillColor(DARK_GREEN).fontSize(12).text('Déstinataire', MARGIN, doc.y);
  doc.moveDown(0.6);
  for (const line of vm.clientLines) {
    sg(doc, { text: line }).fillColor(BLACK).fontSize(10)
      .text(line, MARGIN, doc.y, { width: CONTENT_W * 0.62, lineGap: 1.5 });
    doc.moveDown(0.12);
  }
  doc.moveDown(1);

  // ── Mode de Paiement (left) · Numero + DATE (indented column) ──
  const metaY = doc.y;
  sg(doc, { medium: true }).fillColor(DARK_GREEN).fontSize(11.5)
    .text('Mode de Paiement', MARGIN, metaY);
  sg(doc).fillColor(BLACK).fontSize(10.5)
    .text(vm.paymentLabel, MARGIN, metaY + 19);

  sg(doc, { bold: true }).fillColor(BLACK).fontSize(10.5)
    .text('Numero: ', TABLE_X, metaY, { continued: true });
  sg(doc).fillColor(BLACK).text(vm.number);
  sg(doc, { bold: true }).fillColor(BLACK).fontSize(10.5)
    .text('DATE: ', TABLE_X, metaY + 19, { continued: true });
  sg(doc).fillColor(BLACK).text(vm.date);

  doc.y = metaY + 40;

  // ── Bank details (Virement only) ──
  drawBankLines(doc, vm, MARGIN, DARK_GREEN);

  doc.y += 18;

  // ── Lines table (indented like the reference) ──
  drawLinesTable(doc, vm, { headerColor: DARK_GREEN, headerRule: DARK_GREEN, x0: TABLE_X });
  doc.moveTo(TABLE_X, doc.y + 4).lineTo(PAGE_W - MARGIN, doc.y + 4).lineWidth(0.7).strokeColor(DARK_GREEN).stroke();
  doc.y += 22;

  // ── Totals (right) ──
  drawTotalsBlock(doc, vm, DARK_GREEN);
  doc.y += 12;

  // ── Amount in words — pinned bottom-left ──
  drawAmountInWords(doc, vm);

  // ── Footer ──
  drawContactFooter(doc, vm, GRAY);
  drawCancelledWatermark(doc, vm);
}
