/**
 * Shared pdfkit drawing helpers for the invoice templates.
 *
 * Reuses the receipt pipeline primitives (page geometry, doc lifecycle, image
 * fetching, brand green) and renders ONLY what the view model provides — no
 * money math happens anywhere in this directory.
 */
import type PDFDocument from 'pdfkit';
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, GREEN,
} from '@/server/notifications/receipt';
import { invoiceFontFor, hasArabic } from '@/server/pdf/fonts';
import type { InvoiceViewModel } from '../viewModel';

export { PAGE_W, PAGE_H, MARGIN, CONTENT_W, GREEN };
/** Brand rich black — invoice body text. */
export const BLACK = '#0D0D0D';
export const GRAY = '#6b6b73';
export const HAIRLINE = '#d9d9de';
/** Deep green used for section labels on the official Metwork template. */
export const DARK_GREEN = '#1e5b3c';
/** "Net à Payer" value — red, matching the official reference invoice. */
export const NET_RED = '#d91c1c';

export type Doc = InstanceType<typeof PDFDocument>;
export type TemplateRenderer = (doc: Doc, vm: InvoiceViewModel, logo: Buffer | null) => void;

/** Vertical space always reserved at the page bottom for the contact footer. */
export const FOOTER_RESERVE = 46;

/** Set the invoice face (Space Grotesk; Amiri fallback for Arabic values). */
export function sg(doc: Doc, opts: { bold?: boolean; medium?: boolean; text?: string } = {}): Doc {
  return doc.font(invoiceFontFor({
    bold: opts.bold,
    medium: opts.medium,
    arabic: opts.text ? hasArabic(opts.text) : false,
  }));
}

/** Page-break guard: start a new page when `needed` points don't fit. */
export function ensureSpace(doc: Doc, needed: number, onNewPage?: () => void): void {
  if (doc.y + needed > PAGE_H - MARGIN - FOOTER_RESERVE) {
    doc.addPage();
    doc.y = MARGIN;
    onNewPage?.();
  }
}

/* ─────────────────── Lines table ─────────────────── */

const COL_QTY_W = 45;
const COL_HT_W = 100;
const COL_TVA_W = 55;

export interface TableStyle {
  /** Header text color. */
  headerColor?: string;
  /** Color of the rule under the header. */
  headerRule?: string;
  /** Row separator hairline; omit for no per-row rules. */
  rowRule?: string;
  /** Left edge of the table — defaults to MARGIN (CLASSIC indents it). */
  x0?: number;
}

/**
 * SERVICE | QTY | Montant HT | TVA table. Paginates safely: when a row would
 * overflow the reserved footer area, a new page starts and the header repeats.
 */
export function drawLinesTable(doc: Doc, vm: InvoiceViewModel, style: TableStyle = {}): void {
  const xService = style.x0 ?? MARGIN;
  const xTva = PAGE_W - MARGIN - COL_TVA_W;
  const xHt = xTva - COL_HT_W;
  const xQty = xHt - COL_QTY_W;
  const serviceW = xQty - xService - 10;

  const header = () => {
    const hy = doc.y;
    sg(doc, { bold: true }).fillColor(style.headerColor ?? BLACK).fontSize(9.5);
    doc.text('SERVICE', xService, hy, { width: serviceW });
    doc.text('QTY', xQty, hy, { width: COL_QTY_W - 8, align: 'right' });
    doc.text('Montant HT', xHt, hy, { width: COL_HT_W - 8, align: 'right' });
    doc.text('TVA', xTva, hy, { width: COL_TVA_W, align: 'right' });
    const bottom = doc.y + 5;
    doc.moveTo(xService, bottom).lineTo(PAGE_W - MARGIN, bottom)
      .lineWidth(0.9).strokeColor(style.headerRule ?? BLACK).stroke();
    doc.y = bottom + 9;
  };

  header();

  for (const line of vm.lines) {
    sg(doc, { text: line.designation }).fontSize(10);
    const rowH = Math.max(
      doc.heightOfString(line.designation, { width: serviceW, lineGap: 1.5 }),
      12,
    );
    ensureSpace(doc, rowH + 10, header);

    const ry = doc.y;
    sg(doc, { text: line.designation }).fillColor(BLACK).fontSize(10)
      .text(line.designation, xService, ry, { width: serviceW, lineGap: 1.5 });
    const afterService = doc.y;
    sg(doc).fillColor(BLACK).fontSize(10)
      .text(line.quantity, xQty, ry, { width: COL_QTY_W - 8, align: 'right' });
    sg(doc).fillColor(BLACK).fontSize(10)
      .text(line.amountHt, xHt, ry, { width: COL_HT_W - 8, align: 'right' });
    sg(doc).fillColor(GRAY).fontSize(10)
      .text(line.vat, xTva, ry, { width: COL_TVA_W, align: 'right' });

    doc.y = Math.max(afterService, ry + rowH) + 6;
    if (style.rowRule) {
      doc.moveTo(xService, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
        .lineWidth(0.4).strokeColor(style.rowRule).stroke();
      doc.y += 6;
    }
  }
}

/* ─────────────────── Bank details (VIREMENT) ─────────────────── */

/**
 * "Banque : …" / "RIB : …" lines — vm.bankLines is non-empty only for
 * VIREMENT invoices, so callers can invoke this unconditionally.
 */
export function drawBankLines(doc: Doc, vm: InvoiceViewModel, x: number, labelColor: string = BLACK): void {
  if (vm.bankLines.length === 0) return;
  ensureSpace(doc, vm.bankLines.length * 14 + 4);
  for (const line of vm.bankLines) {
    sg(doc, { medium: true }).fillColor(labelColor).fontSize(9.5)
      .text(line, x, doc.y, { width: CONTENT_W });
    doc.moveDown(0.18);
  }
}

/* ─────────────────── Totals block ─────────────────── */

/**
 * Right-aligned totals column. The timbre row renders only when
 * vm.showTimbre (ESPECE). "Net à Payer" value is emphasized in red (NET_RED),
 * matching the official reference invoice.
 * The whole block is kept together (moved to a new page if it can't fit).
 */
export function drawTotalsBlock(doc: Doc, vm: InvoiceViewModel, labelColor: string = BLACK): void {
  const rows: Array<[string, string, boolean]> = [
    ['TOTAL HT', vm.totals.ht, false],
    ['TVA', vm.totals.tva, false],
    ['TOTAL TTC', vm.totals.ttc, false],
  ];
  if (vm.showTimbre) rows.push(['Droit de timbre', vm.totals.timbre, false]);
  rows.push(['Net à Payer', vm.totals.net, true]);

  const blockH = rows.length * 18 + 14;
  ensureSpace(doc, blockH);

  const labelW = 150;
  const valueW = 130;
  const xValue = PAGE_W - MARGIN - valueW;
  const xLabel = xValue - labelW - 8;

  for (const [label, value, emphasized] of rows) {
    const y = doc.y;
    if (emphasized) {
      doc.moveTo(xLabel, y - 3).lineTo(PAGE_W - MARGIN, y - 3)
        .lineWidth(0.9).strokeColor(BLACK).stroke();
      sg(doc, { bold: true }).fillColor(labelColor).fontSize(11.5)
        .text(`${label}:`, xLabel, y + 3, { width: labelW, align: 'right' });
      sg(doc, { bold: true }).fillColor(NET_RED).fontSize(12.5)
        .text(value, xValue, y + 2, { width: valueW, align: 'right' });
      doc.y = y + 22;
    } else {
      sg(doc, { medium: true }).fillColor(labelColor).fontSize(10)
        .text(`${label}:`, xLabel, y, { width: labelW, align: 'right' });
      sg(doc).fillColor(BLACK).fontSize(10)
        .text(value, xValue, y, { width: valueW, align: 'right' });
      doc.y = y + 18;
    }
  }
}

/* ─────────────────── Amount in words ─────────────────── */

/**
 * "Arrêtée la présente facture à la somme de :" + the frozen words, at the
 * BOTTOM-LEFT of the page (matching the official template): when the content
 * above ends higher, the block is pushed down to sit just above the footer;
 * when the page is already full it flows (possibly onto a new page).
 */
export function drawAmountInWords(doc: Doc, vm: InvoiceViewModel): void {
  sg(doc).fontSize(10);
  const wordsH = doc.heightOfString(vm.amountInWords, { width: CONTENT_W, lineGap: 2 });
  const blockH = 18 + wordsH;
  ensureSpace(doc, blockH);
  const pinnedY = PAGE_H - MARGIN - FOOTER_RESERVE - blockH;
  if (doc.y < pinnedY) doc.y = pinnedY;
  sg(doc, { medium: true }).fillColor(BLACK).fontSize(10)
    .text('Arrêtée la présente facture à la somme de :', MARGIN, doc.y, { width: CONTENT_W });
  doc.moveDown(0.35);
  sg(doc).fillColor(BLACK).fontSize(10)
    .text(vm.amountInWords, MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });
}

/* ─────────────────── Contact footer ─────────────────── */

/** Tiny vector icons — the brand fonts have no emoji glyphs. */
function drawIcon(doc: Doc, kind: 'website' | 'email' | 'phone', x: number, y: number, color: string): void {
  const s = 7; // icon box
  doc.save().lineWidth(0.8).strokeColor(color);
  if (kind === 'website') {
    // Globe: circle + equator + meridian ellipse.
    const r = s / 2;
    doc.circle(x + r, y + r, r).stroke();
    doc.moveTo(x, y + r).lineTo(x + s, y + r).stroke();
    doc.ellipse(x + r, y + r, r * 0.45, r).stroke();
  } else if (kind === 'email') {
    // Envelope: rect + flap.
    doc.rect(x, y + 0.5, s + 2, s - 1).stroke();
    doc.moveTo(x, y + 0.5).lineTo(x + (s + 2) / 2, y + s / 2 + 0.5).lineTo(x + s + 2, y + 0.5).stroke();
  } else {
    // Phone: simple handset arc.
    doc.moveTo(x + 0.5, y + 2).quadraticCurveTo(x + s / 2 + 0.5, y - 1.5, x + s + 0.5, y + 2)
      .stroke();
    doc.circle(x + 1.2, y + 3, 1.1).stroke();
    doc.circle(x + s - 0.2, y + 3, 1.1).stroke();
  }
  doc.restore();
}

/** Three inline contact items, centered at the bottom of the current page. */
export function drawContactFooter(doc: Doc, vm: InvoiceViewModel, color: string = GRAY): void {
  if (vm.footerItems.length === 0) return;
  const y = PAGE_H - MARGIN - 14;

  sg(doc).fontSize(8.5);
  const gap = 22;
  const iconW = 13;
  const widths = vm.footerItems.map((it) => doc.widthOfString(it.value) + iconW);
  const totalW = widths.reduce((s, w) => s + w, 0) + gap * (vm.footerItems.length - 1);
  let x = (PAGE_W - totalW) / 2;

  for (let i = 0; i < vm.footerItems.length; i++) {
    const item = vm.footerItems[i]!;
    drawIcon(doc, item.kind, x, y, color);
    sg(doc).fillColor(color).fontSize(8.5).text(item.value, x + iconW, y, { lineBreak: false });
    x += widths[i]! + gap;
  }
}

/* ─────────────────── Cancelled watermark ─────────────────── */

/**
 * Diagonal "ANNULÉE" watermark so a cancelled invoice PDF can never pass for
 * a valid one.
 */
export function drawCancelledWatermark(doc: Doc, vm: InvoiceViewModel): void {
  if (!vm.cancelled) return;
  doc.save();
  doc.rotate(-30, { origin: [PAGE_W / 2, PAGE_H / 2] });
  sg(doc, { bold: true }).fontSize(88).fillColor(BLACK).fillOpacity(0.08)
    .text('ANNULÉE', 0, PAGE_H / 2 - 44, { width: PAGE_W, align: 'center' });
  doc.restore();
  doc.fillOpacity(1);
}
