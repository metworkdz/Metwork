/**
 * A program's financial report, exported — CSV for a spreadsheet, PDF for a
 * partner, a funder or the accountant.
 *
 * Both are drawn from the one report (./report.ts): an export can never show
 * a figure the Finances tab does not.
 */
import PDFDocument from 'pdfkit';

import { formatDZDWhole } from '@/server/invoices/engine';
import { collectBuffer } from '@/server/notifications/receipt';
import { hasArabic, invoiceFontFor, registerPdfFonts } from '@/server/pdf/fonts';

import type { PaymentChannel, ProgramFinanceReport } from './report';
import type { ProgramFinances } from './service';

export type ExportLang = 'fr' | 'en' | 'ar';

const L: Record<ExportLang, {
  section: string; item: string; value: string;
  billed: string; outstanding: string; collected: string; commission: string; netRevenue: string;
  expenses: string; netProfit: string; projectedProfit: string; margin: string;
  participants: string; paying: string; free: string; seats: string; fillRate: string; absent: string;
  averageTicket: string; costPerParticipant: string; breakEven: string;
  channel: string; channels: Record<PaymentChannel, string>;
  date: string; title: string; category: string; amount: string; description: string; receipt: string;
  summary: string; people: string; unit: string; takings: string; expenseList: string;
}> = {
  fr: {
    section: 'Rubrique', item: 'Indicateur', value: 'Valeur',
    billed: 'Facturé', outstanding: 'Reste à encaisser', collected: 'Encaissé', commission: 'Commission Metwork',
    netRevenue: 'Revenu net', expenses: 'Dépenses', netProfit: 'Bénéfice net', projectedProfit: 'Bénéfice prévisionnel',
    margin: 'Marge nette', participants: 'Participants', paying: 'Participants payants', free: 'Participants gratuits',
    seats: 'Places', fillRate: 'Taux de remplissage', absent: 'Absents', averageTicket: 'Panier moyen',
    costPerParticipant: 'Coût par participant', breakEven: 'Seuil de rentabilité (participants payants)',
    channel: 'Moyen de paiement', channels: { CARD: 'Carte', WALLET: 'Portefeuille Metwork', CASH: 'Espèces', OTHER: 'Autre' },
    date: 'Date', title: 'Libellé', category: 'Catégorie', amount: 'Montant (DA)', description: 'Description', receipt: 'Justificatif',
    summary: 'Synthèse', people: 'Participants', unit: 'Indicateurs unitaires', takings: 'Encaissements', expenseList: 'Dépenses',
  },
  en: {
    section: 'Section', item: 'Metric', value: 'Value',
    billed: 'Billed', outstanding: 'Still to collect', collected: 'Collected', commission: 'Metwork commission',
    netRevenue: 'Net revenue', expenses: 'Expenses', netProfit: 'Net profit', projectedProfit: 'Projected profit',
    margin: 'Net margin', participants: 'Participants', paying: 'Paying participants', free: 'Free participants',
    seats: 'Seats', fillRate: 'Fill rate', absent: 'Absent', averageTicket: 'Average ticket',
    costPerParticipant: 'Cost per participant', breakEven: 'Break-even (paying participants)',
    channel: 'Payment method', channels: { CARD: 'Card', WALLET: 'Metwork wallet', CASH: 'Cash', OTHER: 'Other' },
    date: 'Date', title: 'Label', category: 'Category', amount: 'Amount (DZD)', description: 'Description', receipt: 'Receipt',
    summary: 'Summary', people: 'Participants', unit: 'Unit metrics', takings: 'Takings', expenseList: 'Expenses',
  },
  ar: {
    section: 'القسم', item: 'المؤشر', value: 'القيمة',
    billed: 'المفوتر', outstanding: 'المتبقي للتحصيل', collected: 'المحصّل', commission: 'عمولة Metwork',
    netRevenue: 'الإيراد الصافي', expenses: 'المصاريف', netProfit: 'الربح الصافي', projectedProfit: 'الربح المتوقع',
    margin: 'الهامش الصافي', participants: 'المشاركون', paying: 'المشاركون الدافعون', free: 'المشاركون المجانيون',
    seats: 'المقاعد', fillRate: 'نسبة الامتلاء', absent: 'الغائبون', averageTicket: 'متوسط السعر',
    costPerParticipant: 'التكلفة لكل مشارك', breakEven: 'عتبة المردودية (مشاركون دافعون)',
    channel: 'وسيلة الدفع', channels: { CARD: 'بطاقة', WALLET: 'محفظة Metwork', CASH: 'نقداً', OTHER: 'أخرى' },
    date: 'التاريخ', title: 'البيان', category: 'الفئة', amount: 'المبلغ (دج)', description: 'الوصف', receipt: 'الوصل',
    summary: 'الملخص', people: 'المشاركون', unit: 'المؤشرات الوحدوية', takings: 'التحصيلات', expenseList: 'المصاريف',
  },
};

export function normalizeExportLang(lang: string | null | undefined): ExportLang {
  return lang === 'en' ? 'en' : lang === 'ar' ? 'ar' : 'fr';
}

/* ─────────────────────────── CSV ─────────────────────────── */

/**
 * One CSV cell. Quoted when needed, and neutralised when it starts like a
 * formula: an expense titled "=HYPERLINK(...)" would otherwise run in the
 * accountant's spreadsheet. Numbers are written bare so they stay numbers.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pct(n: number | null): string {
  return n == null ? '' : `${Math.round(n * 1000) / 10} %`;
}

/** A percentage as a bare number (−108.2), so the spreadsheet can sum it. */
function pctNumber(n: number | null): number | null {
  return n == null ? null : Math.round(n * 1000) / 10;
}

/**
 * Two blocks in one sheet: the indicators (section, metric, value), a blank
 * line, then the expenses. UTF-8 BOM and CRLF so Excel reads accents and
 * Arabic straight away.
 */
export function buildProgramFinanceCsv(f: ProgramFinances, lang: ExportLang): string {
  const t = L[lang];
  const r = f.report;
  const rows: Array<Array<string | number | null>> = [
    [t.section, t.item, t.value],
    [t.summary, t.billed, r.billed],
    [t.summary, t.outstanding, r.outstanding],
    [t.summary, t.collected, r.collected],
    [t.summary, t.commission, r.commission],
    [t.summary, t.netRevenue, r.netRevenue],
    [t.summary, t.expenses, r.expensesTotal],
    [t.summary, t.netProfit, r.netProfit],
    [t.summary, t.projectedProfit, r.projectedProfit],
    [t.summary, `${t.margin} (%)`, pctNumber(r.margin)],
    [t.people, t.participants, r.participants],
    [t.people, t.paying, r.payingParticipants],
    [t.people, t.free, r.freeParticipants],
    [t.people, t.seats, r.seatsTotal || null],
    [t.people, `${t.fillRate} (%)`, pctNumber(r.fillRate)],
    [t.people, t.absent, r.absent],
    [t.unit, t.averageTicket, r.averageTicket],
    [t.unit, t.costPerParticipant, r.costPerParticipant],
    [t.unit, t.breakEven, r.breakEvenParticipants],
    ...r.byChannel.map((c) => [t.takings, t.channels[c.channel], c.amount] as Array<string | number>),
    [],
    [t.date, t.title, t.category, t.amount, t.description, t.receipt],
    ...f.expenses.map((e) => [e.date, e.title, e.category, e.amount, e.description, e.receiptUrl ?? null]),
  ];
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/* ─────────────────────────── PDF ─────────────────────────── */

type Doc = InstanceType<typeof PDFDocument>;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 48;
const INK = '#18181b';
const MUTED = '#71717a';
const RULE = '#e4e4e7';
const GREEN = '#1b7e40';
const RED = '#c91d1d';
const BLUE = '#2563eb';

/**
 * Text as it should be seen. pdfkit lays glyphs left to right, so a run of
 * Arabic words is put in reading order here: each word is shaped by the font,
 * the run's word order is reversed.
 */
function visualWords(text: string): Array<{ word: string; arabic: boolean }> {
  const words = text.split(/\s+/).filter(Boolean).map((word) => ({ word, arabic: hasArabic(word) }));
  const out: typeof words = [];
  for (let i = 0; i < words.length;) {
    if (!words[i]!.arabic) { out.push(words[i]!); i++; continue; }
    let j = i;
    while (j + 1 < words.length && words[j + 1]!.arabic) j++;
    out.push(...words.slice(i, j + 1).reverse());
    i = j + 1;
  }
  return out;
}

/** One line of text in a box, ellipsised to fit, in the right face per word. */
function cell(
  doc: Doc, text: string, x: number, y: number, width: number,
  opts: { size?: number; bold?: boolean; medium?: boolean; color?: string; align?: 'left' | 'right' } = {},
) {
  const size = opts.size ?? 9.5;
  const font = (arabic: boolean) => invoiceFontFor({ arabic, bold: opts.bold, medium: opts.medium });
  const measure = (ws: Array<{ word: string; arabic: boolean }>) => {
    doc.font(font(false)).fontSize(size);
    const space = doc.widthOfString(' ');
    return ws.reduce((a, w, k) => a + doc.font(font(w.arabic)).fontSize(size).widthOfString(w.word) + (k ? space : 0), 0);
  };
  let words = visualWords(text);
  // Shorten from the end of the logical text until it fits.
  let logical = text.split(/\s+/).filter(Boolean);
  while (logical.length > 1 && measure(words) > width) {
    logical = logical.slice(0, -1);
    words = visualWords(`${logical.join(' ')} …`);
  }
  const total = measure(words);
  doc.font(font(false)).fontSize(size);
  const space = doc.widthOfString(' ');
  let cx = opts.align === 'right' ? x + width - total : x;
  words.forEach((w, k) => {
    if (k) cx += space;
    doc.font(font(w.arabic)).fontSize(size).fillColor(opts.color ?? INK)
      .text(w.word, cx, y, { lineBreak: false });
    cx += doc.widthOfString(w.word);
  });
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Algiers' })
    .format(new Date(iso));
}

function money(n: number): string {
  return formatDZDWhole(n);
}

/**
 * The report on A4, in French — the language of the invoices and documents
 * the platform issues.
 */
export async function renderProgramFinancePdf(f: ProgramFinances, now: Date = new Date()): Promise<Buffer> {
  const t = L.fr;
  const r: ProgramFinanceReport = f.report;
  const doc = new PDFDocument({
    size: 'A4', margin: 0, autoFirstPage: false,
    // The page footer ("1 / 3") is written once every page exists.
    bufferPages: true,
    info: { Title: `Rapport financier — ${f.program.title}`, Creator: 'Metwork', Producer: 'Metwork' },
  });
  registerPdfFonts(doc);
  doc.addPage({ size: 'A4', margin: 0 });

  const width = PAGE_W - 2 * M;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - M - 20) {
      doc.addPage({ size: 'A4', margin: 0 });
      y = M;
    }
  };

  /* ── Header ── */
  cell(doc, 'RAPPORT FINANCIER', M, y, width, { size: 9, bold: true, color: GREEN });
  y += 16;
  cell(doc, f.program.title, M, y, width, { size: 17, bold: true });
  y += 26;
  const dates = f.program.startDate && f.program.endDate
    ? `${fmtDate(f.program.startDate)} – ${fmtDate(f.program.endDate)}`
    : 'Dates à confirmer';
  cell(doc, [f.organizer, dates].filter(Boolean).join('  ·  '), M, y, width, { size: 9.5, color: MUTED });
  y += 24;

  /* ── Key figures ── */
  const tiles: Array<[string, number, string]> = [
    [t.collected, r.collected, INK],
    [t.expenses, r.expensesTotal, INK],
    [t.netProfit, r.netProfit, r.netProfit < 0 ? RED : GREEN],
    [t.outstanding, r.outstanding, INK],
  ];
  const gap = 10;
  const tileW = (width - gap * 3) / 4;
  tiles.forEach(([label, value, color], i) => {
    const x = M + i * (tileW + gap);
    doc.roundedRect(x, y, tileW, 58, 6).lineWidth(0.8).strokeColor(RULE).stroke();
    cell(doc, label, x + 10, y + 10, tileW - 20, { size: 8, color: MUTED });
    cell(doc, money(value), x + 10, y + 28, tileW - 20, { size: 12.5, bold: true, color });
  });
  y += 58 + 26;

  /* ── Rows ── */
  const section = (title: string) => {
    ensure(40);
    cell(doc, title.toUpperCase(), M, y, width, { size: 8.5, bold: true, color: MUTED });
    y += 14;
    doc.moveTo(M, y).lineTo(M + width, y).lineWidth(0.6).strokeColor(RULE).stroke();
    y += 7;
  };
  const row = (label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => {
    ensure(18);
    cell(doc, label, M, y, width * 0.65, { size: 10, bold: opts.bold });
    cell(doc, value, M + width * 0.65, y, width * 0.35, { size: 10, bold: opts.bold, color: opts.color, align: 'right' });
    y += 18;
  };

  section('Du facturé au bénéfice');
  row(t.billed, money(r.billed));
  row(`− ${t.outstanding}`, money(-r.outstanding), { color: BLUE });
  row(`= ${t.collected}`, money(r.collected), { bold: true });
  row(`− ${t.commission}`, money(-r.commission), { color: RED });
  row(`− ${t.expenses}`, money(-r.expensesTotal), { color: RED });
  row(`= ${t.netProfit}`, money(r.netProfit), { bold: true, color: r.netProfit < 0 ? RED : GREEN });
  row(t.margin, pct(r.margin) || '—');
  row(t.projectedProfit, money(r.projectedProfit));
  y += 12;

  section(t.people);
  row(t.participants, String(r.participants));
  row(t.paying, String(r.payingParticipants));
  row(t.free, String(r.freeParticipants));
  if (r.seatsTotal) row(t.fillRate, `${pct(r.fillRate)}  (${r.participants} / ${r.seatsTotal})`);
  if (r.absent) row(t.absent, String(r.absent));
  y += 12;

  section(t.unit);
  row(t.averageTicket, r.averageTicket == null ? '—' : money(r.averageTicket));
  row(t.costPerParticipant, r.costPerParticipant == null ? '—' : money(r.costPerParticipant));
  row(t.breakEven, r.breakEvenParticipants == null ? '—' : String(r.breakEvenParticipants));
  y += 12;

  if (r.byChannel.length) {
    section(t.takings);
    for (const c of r.byChannel) row(t.channels[c.channel], money(c.amount));
    y += 12;
  }

  /* ── Expenses ── */
  section(t.expenseList);
  if (f.expenses.length === 0) {
    cell(doc, 'Aucune dépense enregistrée pour ce programme.', M, y, width, { size: 10, color: MUTED });
    y += 18;
  } else {
    const cols = [0, 78, 330, width - 100];
    const head = () => {
      ensure(18);
      cell(doc, t.date, M + cols[0]!, y, 70, { size: 8.5, bold: true, color: MUTED });
      cell(doc, t.title, M + cols[1]!, y, 240, { size: 8.5, bold: true, color: MUTED });
      cell(doc, t.category, M + cols[2]!, y, cols[3]! - cols[2]! - 8, { size: 8.5, bold: true, color: MUTED });
      cell(doc, 'Montant', M + cols[3]!, y, 100, { size: 8.5, bold: true, color: MUTED, align: 'right' });
      y += 16;
    };
    head();
    for (const e of f.expenses) {
      if (y + 18 > PAGE_H - M - 20) { ensure(1000); head(); }
      cell(doc, e.date.split('-').reverse().join('/'), M + cols[0]!, y, 70, { size: 9.5 });
      cell(doc, e.title, M + cols[1]!, y, 240, { size: 9.5 });
      cell(doc, e.category ?? '—', M + cols[2]!, y, cols[3]! - cols[2]! - 8, { size: 9.5, color: MUTED });
      cell(doc, money(e.amount), M + cols[3]!, y, 100, { size: 9.5, align: 'right' });
      y += 17;
    }
    doc.moveTo(M, y).lineTo(M + width, y).lineWidth(0.6).strokeColor(RULE).stroke();
    y += 6;
    row('Total', money(r.expensesTotal), { bold: true });
  }

  /* ── Footer on every page ── */
  const range = doc.bufferedPageRange();
  const stamp = `Généré sur Metwork le ${fmtDate(now.toISOString())} · montants TTC en dinars algériens`;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    cell(doc, stamp, M, PAGE_H - M + 8, width - 60, { size: 7.5, color: MUTED });
    cell(doc, `${i - range.start + 1} / ${range.count}`, M + width - 60, PAGE_H - M + 8, 60, { size: 7.5, color: MUTED, align: 'right' });
  }

  return collectBuffer(doc);
}

/** "Rapport financier - Formation juridique.csv" — safe in a header. */
export function financeFilename(title: string, ext: 'csv' | 'pdf'): string {
  const ascii = `Rapport financier - ${title}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[\s-]+$/, '');
  return `${ascii}.${ext}`;
}
