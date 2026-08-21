/**
 * PDF receipt generator.
 *
 * Produces an A4 PDF buffer for:
 *  - Standard bookings   (space / program / event)  → full payment receipt
 *  - Payment-link payments                          → guest receipt
 *  - Mentor consultations                           → request confirmation
 *  - Manual / offline bookings                      → same as standard
 *
 * Layout follows Metwork's official letterhead receipt: company legal block
 * (RC / NIF / address …) top-left, logo top-right, a centered underlined title,
 * a "billed to" block, a details table, the total (with the amount spelled out
 * in words), the payment lines, an attestation sentence, and the incubator's
 * stamp at the bottom.
 *
 * Uses pdfkit (pure Node.js, no native deps — works on Vercel serverless) with
 * an EMBEDDED Unicode serif font (see src/server/pdf/fonts.ts) so French
 * typography (narrow/thin no-break spaces, guillemets, dashes …) and Arabic
 * client names render correctly — the pdfkit built-ins only cover CP1252 and
 * garble anything else.
 */
import PDFDocument from 'pdfkit';
import type { BookingRecord, IncubatorRecord, MentorBookingRecord, MentorRecord, PaymentLinkRecord } from '@/server/db/store';
import { registerPdfFonts, fontFor, hasArabic, FONT } from '@/server/pdf/fonts';
import { amountInWords } from './amount-words';

/* ─────────────────── Types ─────────────────── */

export type ReceiptLang = 'en' | 'fr';

/**
 * Which receipt this is:
 *  - 'standard' — single full payment (wallet / manual / ONLINE_FULL card).
 *  - 'deposit'  — interim receipt for a CASH_DEPOSIT booking: deposit paid by
 *                 card, balance still due in cash on-site.
 *  - 'final'    — issued once the cash balance has been collected (paid in full).
 */
export type ReceiptVariant = 'standard' | 'deposit' | 'final';

/** Incubator fields printed on the letterhead + stamp. */
type ReceiptIncubator = Pick<
  IncubatorRecord,
  'name' | 'email' | 'phone' | 'city' | 'logoUrl' | 'stampUrl' | 'address'
  | 'registrationNumber' | 'commercialRegNumber' | 'nif'
>;

/** Loose structural type the letterhead reads — accepts partial/ad-hoc objects. */
type LetterheadInfo = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  registrationNumber?: string | null;
  commercialRegNumber?: string | null;
  nif?: string | null;
};

export interface BookingReceiptInput {
  booking:      BookingRecord;
  /** Display name of the client (platform user or offline client). */
  clientName:   string;
  /** Email we are sending to — shown on the receipt. */
  clientEmail:  string;
  /** Client phone, when known (offline bookings capture it). */
  clientPhone?: string | null;
  incubator:    ReceiptIncubator;
  lang:         ReceiptLang;
  /** Defaults to 'standard'. CASH_DEPOSIT bookings use 'deposit' / 'final'. */
  variant?:     ReceiptVariant;
}

export interface MentorConfirmationInput {
  booking: MentorBookingRecord;
  mentor:  MentorRecord;
  lang:    ReceiptLang;
}

/* ─────────────────── i18n strings ─────────────────── */

interface Copy {
  receipt: string;
  depositReceipt: string;
  receiptNo: string;
  date: string;
  receivedFrom: string;
  clientNameLabel: string;
  phone: string;
  email: string;
  paymentDetails: string;
  colService: string;
  colPeriod: string;
  colAmount: string;
  totalPaid: string;
  depositPaid: string;
  cashBalance: string;
  paidInFull: string;
  awaitingCash: string;
  platformFee: string;
  inWordsSuffix: string;   // e.g. "dinars"
  paymentMethod: string;
  paymentDate: string;
  methodOnline: string;
  methodCash: string;
  methodCard: string;
  /**
   * Visa/Mastercard. Deliberately generic — the receipt never names the
   * processor, never shows a foreign currency and never shows a rate. The
   * amount above is the DZD the client was quoted and owes.
   */
  methodInternationalCard: string;
  attestation: (name: string) => string;
  poweredBy: string;
  free: string;
  hour: string; halfDay: string; day: string; month: string;
  space: string; program: string; event: string;
  // consultation
  consultTitle: string; consultRef: string; requestedOn: string;
  requestedBy: string; consultant: string; position: string;
  message: string; consultNote: string; duration: string;
  confirmedDate: string; requestedDate: string; meetingLink: string;
  inPerson: string; amountPaid: string; freeCredit: string;
  method: string; teamNote: string;
}

const COPY: Record<ReceiptLang, Copy> = {
  fr: {
    receipt: 'REÇU DE PAIEMENT',
    depositReceipt: 'REÇU D’ACOMPTE',
    receiptNo: 'N°',
    date: 'Date',
    receivedFrom: 'Reçu de',
    clientNameLabel: 'Nom du client',
    phone: 'Téléphone',
    email: 'Email',
    paymentDetails: 'Détails du paiement',
    colService: 'Description du service',
    colPeriod: 'Période',
    colAmount: 'Montant (DZD)',
    totalPaid: 'Total payé',
    depositPaid: 'Acompte payé (carte)',
    cashBalance: 'Solde (espèces sur place)',
    paidInFull: 'Payé intégralement',
    awaitingCash: 'En attente d’espèces sur place',
    platformFee: 'Frais de plateforme',
    inWordsSuffix: 'dinars',
    paymentMethod: 'Mode de paiement',
    paymentDate: 'Date du paiement',
    methodOnline: 'En ligne (portefeuille)',
    methodCash: 'Espèces',
    methodCard: 'Carte (CIB / Edahabia)',
    methodInternationalCard: 'Carte internationale',
    attestation: (name) => `Ce reçu atteste que le montant mentionné ci-dessus a bien été reçu par ${name} au titre des services rendus.`,
    poweredBy: 'Propulsé par Metwork',
    free: 'Gratuit',
    hour: 'heure', halfDay: 'demi-journée', day: 'jour', month: 'mois',
    space: 'Espace', program: 'Programme', event: 'Événement',
    consultTitle: 'DEMANDE DE CONSULTATION CONFIRMÉE',
    consultRef: 'Référence', requestedOn: 'Demandé le',
    requestedBy: 'Demandé par', consultant: 'Consultant', position: 'Poste',
    message: 'Votre message', consultNote: 'Le consultant vous enverra prochainement les détails de la réunion.',
    duration: 'Durée', confirmedDate: 'Date confirmée', requestedDate: 'Date demandée',
    meetingLink: 'Lien de réunion', inPerson: 'Présentiel', amountPaid: 'Montant payé',
    freeCredit: 'Crédit mensuel gratuit', method: 'Méthode', teamNote: 'NOTE DE L’ÉQUIPE',
  },
  en: {
    receipt: 'PAYMENT RECEIPT',
    depositReceipt: 'DEPOSIT RECEIPT',
    receiptNo: 'No.',
    date: 'Date',
    receivedFrom: 'Received from',
    clientNameLabel: 'Client name',
    phone: 'Phone',
    email: 'Email',
    paymentDetails: 'Payment details',
    colService: 'Service description',
    colPeriod: 'Period',
    colAmount: 'Amount (DZD)',
    totalPaid: 'Total paid',
    depositPaid: 'Deposit paid (card)',
    cashBalance: 'Balance (cash on-site)',
    paidInFull: 'Paid in full',
    awaitingCash: 'Awaiting cash on-site',
    platformFee: 'Platform fee',
    inWordsSuffix: 'dinars',
    paymentMethod: 'Payment method',
    paymentDate: 'Payment date',
    methodOnline: 'Online (wallet)',
    methodCash: 'Cash',
    methodCard: 'Card (CIB / Edahabia)',
    methodInternationalCard: 'International card',
    attestation: (name) => `This receipt certifies that the amount above has been duly received by ${name} for the services rendered.`,
    poweredBy: 'Powered by Metwork',
    free: 'Free',
    hour: 'hour', halfDay: 'half-day', day: 'day', month: 'month',
    space: 'Space', program: 'Program', event: 'Event',
    consultTitle: 'CONSULTATION REQUEST CONFIRMED',
    consultRef: 'Reference', requestedOn: 'Requested on',
    requestedBy: 'Requested by', consultant: 'Consultant', position: 'Position',
    message: 'Your message', consultNote: 'The consultant will send you the meeting details shortly.',
    duration: 'Duration', confirmedDate: 'Confirmed date', requestedDate: 'Requested date',
    meetingLink: 'Meeting link', inPerson: 'In-person', amountPaid: 'Amount paid',
    freeCredit: 'Free monthly credit', method: 'Method', teamNote: 'TEAM NOTE',
  },
};

/* ─────────────────── Image fetcher ─────────────────── */

/**
 * Fetch a remote image URL and return its raw bytes as a Buffer.
 * Returns null on any network / decode error so callers can gracefully skip.
 */
export async function fetchImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/* ─────────────────── Layout constants (points, A4) ─────────────────── */

export const PAGE_W    = 595.28;
export const PAGE_H    = 841.89;
export const MARGIN    = 56;
export const CONTENT_W = PAGE_W - MARGIN * 2;

export const GREEN  = '#30a735';
export const DARK   = '#111114';
export const INK    = '#26262b';
export const GRAY   = '#6b6b73';
export const RULE   = '#d9d9de';
export const LIGHT  = '#f6f6f4';
export const WHITE  = '#ffffff';

/* ─────────────────── Helpers ─────────────────── */

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-DZ').replace(/ | /g, ' ') + ' DZD';
}

function fmtDate(iso: string, lang: ReceiptLang): string {
  try {
    return new Date(iso).toLocaleString(lang === 'fr' ? 'fr-DZ' : 'en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }).replace(/ | /g, ' ');
  } catch { return iso; }
}

function fmtDateOnly(iso: string, lang: ReceiptLang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-DZ' : 'en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
  } catch { return iso.slice(0, 10); }
}

/** Compact "22/09/2025 09:30–17:00" (or a plain date range for multi-day). */
function fmtPeriod(startsAt: string, endsAt: string, unit: BookingRecord['unit'], lang: ReceiptLang): string {
  try {
    const s = new Date(startsAt), e = new Date(endsAt);
    const d = (x: Date) => x.toLocaleDateString(lang === 'fr' ? 'fr-DZ' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    const t = (x: Date) => x.toLocaleTimeString(lang === 'fr' ? 'fr-DZ' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });
    const sameDay = d(s) === d(e);
    if (unit === 'HOUR' || unit === 'HALF_DAY') return `${d(s)} ${t(s)}–${t(e)}`;
    return sameDay ? d(s) : `${d(s)} → ${d(e)}`;
  } catch { return ''; }
}

type Doc = InstanceType<typeof PDFDocument>;

/** Set the body font honouring weight/italic and Arabic script in the value. */
function setFont(doc: Doc, opts: { bold?: boolean; italic?: boolean; arabic?: boolean } = {}): Doc {
  return doc.font(fontFor(opts));
}

/* ─────────────────── PDF lifecycle ─────────────────── */

export function makeDoc(): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Creator: 'Metwork', Producer: 'Metwork' },
  });
  registerPdfFonts(doc);
  return doc;
}

export async function collectBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/* ─────────────────── Letterhead (company block + logo) ─────────────────── */

/**
 * Company legal block on the left, logo on the right. Leaves `doc.y` just below
 * the taller column, plus a thin brand rule.
 */
function drawLetterhead(doc: Doc, incubator: LetterheadInfo, logoBuffer: Buffer | null, lang: ReceiptLang): void {
  const startY = MARGIN;
  const LOGO_W = 150, LOGO_H = 60, GAP = 18;
  const hasLogo = !!logoBuffer;
  const infoW = hasLogo ? CONTENT_W - LOGO_W - GAP : CONTENT_W;

  if (hasLogo) {
    try {
      doc.image(logoBuffer as Buffer, PAGE_W - MARGIN - LOGO_W, startY + 2, { fit: [LOGO_W, LOGO_H], align: 'right' });
    } catch { /* skip logo on error */ }
  }

  // Company name (bold).
  const nameArabic = hasArabic(incubator.name ?? '');
  setFont(doc, { bold: true, arabic: nameArabic }).fillColor(DARK).fontSize(15)
    .text(incubator.name ?? 'Metwork', MARGIN, startY, { width: infoW });

  // Legal / contact lines.
  const rc = incubator.commercialRegNumber ?? incubator.registrationNumber ?? null;
  const L = lang === 'fr'
    ? { rc: 'RC', nif: 'NIF', address: 'Adresse', phone: 'Tél', email: 'Email' }
    : { rc: 'RC', nif: 'NIF', address: 'Address', phone: 'Phone', email: 'Email' };
  const lines: Array<[string, string]> = [];
  if (rc)                lines.push([L.rc, rc]);
  if (incubator.nif)     lines.push([L.nif, incubator.nif]);
  if (incubator.address) lines.push([L.address, incubator.address]);
  if (incubator.phone)   lines.push([L.phone, incubator.phone]);
  if (incubator.email)   lines.push([L.email, incubator.email]);

  doc.moveDown(0.35);
  for (const [label, value] of lines) {
    const y = doc.y;
    setFont(doc).fillColor(GRAY).fontSize(9.5).text(`${label} : `, MARGIN, y, { continued: true })
      .fillColor(INK).text(value, { width: infoW });
    doc.moveDown(0.12);
  }

  const bottom = Math.max(doc.y, hasLogo ? startY + LOGO_H : startY);
  // Thin brand rule under the letterhead.
  doc.moveTo(MARGIN, bottom + 8).lineTo(PAGE_W - MARGIN, bottom + 8).lineWidth(1.4).strokeColor(GREEN).stroke();
  doc.y = bottom + 20;
}

/* ─────────────────── Title + meta (N° / Date) ─────────────────── */

function drawTitle(doc: Doc, title: string, refNo: string, dateStr: string, c: Copy): void {
  doc.moveDown(0.4);
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(19)
    .text(title, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  // Green underline centered under the title.
  const tw = doc.widthOfString(title);
  const uy = doc.y + 2;
  doc.moveTo(PAGE_W / 2 - tw / 2, uy).lineTo(PAGE_W / 2 + tw / 2, uy).lineWidth(1.4).strokeColor(GREEN).stroke();

  doc.moveDown(1.1);
  const y = doc.y;
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(10.5).text(`${c.receiptNo} : `, MARGIN, y, { continued: true })
    .fillColor(INK).font(FONT.body).text(refNo);
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(10.5).text(`${c.date} : `, MARGIN, doc.y, { continued: true })
    .fillColor(INK).font(FONT.body).text(dateStr);
}

/* ─────────────────── Section helpers ─────────────────── */

function sectionRule(doc: Doc): void {
  const y = doc.y + 10;
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.7).strokeColor(RULE).stroke();
  doc.y = y + 12;
}

function sectionLabel(doc: Doc, label: string): void {
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(11.5).text(`${label} :`, MARGIN, doc.y);
  doc.moveDown(0.45);
}

/** "Label : value" inline line. */
function labelLine(doc: Doc, label: string, value: string): void {
  const arabic = hasArabic(value);
  const y = doc.y;
  setFont(doc).fillColor(GRAY).fontSize(10.5).text(`${label} : `, MARGIN, y, { continued: true })
    .fillColor(INK).font(fontFor({ arabic })).text(value || '—', { width: CONTENT_W - 20 });
  doc.moveDown(0.28);
}

/* ─────────────────── Details table ─────────────────── */

interface DetailRow { service: string; period: string; amount: string }

function drawDetailsTable(doc: Doc, c: Copy, rows: DetailRow[]): void {
  const x0 = MARGIN;
  const colService = x0;
  const colAmountW = 110;
  const colPeriodW = 150;
  const colPeriod = PAGE_W - MARGIN - colAmountW - colPeriodW;
  const colAmount = PAGE_W - MARGIN - colAmountW;
  const serviceW = colPeriod - colService - 12;

  // Header row.
  const hy = doc.y;
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(10);
  doc.text(c.colService, colService, hy, { width: serviceW });
  doc.text(c.colPeriod, colPeriod, hy, { width: colPeriodW - 8 });
  doc.text(c.colAmount, colAmount, hy, { width: colAmountW, align: 'right' });
  const headerBottom = doc.y + 4;
  doc.moveTo(x0, headerBottom).lineTo(PAGE_W - MARGIN, headerBottom).lineWidth(0.8).strokeColor('#c8c8cf').stroke();
  doc.y = headerBottom + 8;

  for (const r of rows) {
    const ry = doc.y;
    setFont(doc, { arabic: hasArabic(r.service) }).fillColor(INK).fontSize(10.5)
      .text(r.service, colService, ry, { width: serviceW });
    const afterService = doc.y;
    setFont(doc).fillColor(INK).fontSize(9.5).text(r.period, colPeriod, ry, { width: colPeriodW - 8, lineGap: 2 });
    const afterPeriod = doc.y;
    setFont(doc, { bold: true }).fillColor(DARK).fontSize(11).text(r.amount, colAmount, ry, { width: colAmountW, align: 'right' });
    doc.y = Math.max(afterService, afterPeriod, doc.y) + 8;
  }
}

/* ─────────────────── Stamp ─────────────────── */

/**
 * Draws the incubator's stamp near the bottom-right, above the footer. When no
 * stamp image is configured, nothing is drawn (the receipt stays clean rather
 * than showing a placeholder).
 */
function drawStamp(doc: Doc, stampBuffer: Buffer | null): void {
  if (!stampBuffer) return;
  const STAMP = 120;
  const x = PAGE_W - MARGIN - STAMP;
  const y = PAGE_H - MARGIN - STAMP - 26;
  try {
    doc.save();
    doc.image(stampBuffer, x, y, { fit: [STAMP, STAMP], align: 'center', valign: 'center' });
    doc.restore();
  } catch { /* skip on decode error */ }
}

/* ─────────────────── Footer (attestation) ─────────────────── */

function drawFooter(doc: Doc, c: Copy, incubatorName: string): void {
  const y = PAGE_H - MARGIN - 8;
  setFont(doc).fillColor(GRAY).fontSize(8.5)
    .text(`© ${new Date().getFullYear()} ${incubatorName}  ·  ${c.poweredBy}`, MARGIN, y, { width: CONTENT_W, align: 'center' });
}

/* ─────────────────── Main: booking receipt ─────────────────── */

export async function generateBookingReceiptPdf(input: BookingReceiptInput): Promise<Buffer> {
  const { booking, clientName, clientEmail, clientPhone, incubator, lang } = input;
  const c = COPY[lang];

  const isCashDeposit = booking.paymentMode === 'CASH_DEPOSIT';
  const variant: ReceiptVariant = input.variant ?? (isCashDeposit
    ? (booking.paymentStatus === 'PAID' ? 'final' : 'deposit')
    : 'standard');
  const onlinePaid  = booking.onlinePaidAmount ?? 0;
  const cashBalance = booking.cashRemainingAmount ?? 0;
  const payerFee    = booking.payerFeeAmount ?? 0;

  const [logoBuffer, stampBuffer] = await Promise.all([
    fetchImageBuffer(incubator.logoUrl),
    fetchImageBuffer(incubator.stampUrl),
  ]);

  const doc = makeDoc();

  // ── Letterhead ──
  drawLetterhead(doc, incubator, logoBuffer, lang);

  // ── Title + meta ──
  const title = variant === 'deposit' ? c.depositReceipt : c.receipt;
  drawTitle(doc, title, booking.clientReference, fmtDateOnly(booking.createdAt, lang), c);

  // ── Received from ──
  // Prefer an explicit phone; otherwise fall back to the phone stored on an
  // offline booking so manual receipts show "Téléphone" without every caller
  // having to thread it through.
  const phone = clientPhone ?? booking.clientPhone ?? null;
  sectionRule(doc);
  sectionLabel(doc, c.receivedFrom);
  labelLine(doc, c.clientNameLabel, clientName);
  if (phone) labelLine(doc, c.phone, phone);
  labelLine(doc, c.email, clientEmail || '—');

  // ── Payment details table ──
  sectionRule(doc);
  sectionLabel(doc, c.paymentDetails);
  const kind = booking.itemKind === 'SPACE' ? c.space : booking.itemKind === 'PROGRAM' ? c.program : c.event;
  drawDetailsTable(doc, c, [{
    service: booking.itemName || kind,
    period:  fmtPeriod(booking.startsAt, booking.endsAt, booking.unit, lang),
    amount:  booking.totalAmount === 0 ? c.free : booking.totalAmount.toLocaleString('fr-DZ').replace(/ | /g, ' '),
  }]);

  // ── Total (highlighted) + amount in words ──
  doc.moveDown(0.6);
  const totalY = doc.y;
  doc.rect(MARGIN, totalY, CONTENT_W, 38).fill(LIGHT);
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(12).text(`${c.totalPaid}`, MARGIN + 14, totalY + 12, { width: 200 });
  const totalStr = booking.totalAmount === 0 ? c.free : fmtMoney(booking.totalAmount);
  setFont(doc, { bold: true }).fillColor(GREEN).fontSize(14).text(totalStr, MARGIN + 200, totalY + 11, { width: CONTENT_W - 214, align: 'right' });
  doc.y = totalY + 46;
  if (booking.totalAmount > 0) {
    setFont(doc, { italic: true }).fillColor(GRAY).fontSize(9.5)
      .text(`(${amountInWords(booking.totalAmount, lang)} ${c.inWordsSuffix})`, MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.2);
  }

  // ── Deposit / balance split (card CASH_DEPOSIT) ──
  if (isCashDeposit) {
    doc.moveDown(0.2);
    labelLine(doc, c.depositPaid, fmtMoney(onlinePaid));
    if (payerFee > 0) labelLine(doc, c.platformFee, `+ ${fmtMoney(payerFee)}`);
    labelLine(doc, c.cashBalance, `${fmtMoney(cashBalance)} — ${variant === 'final' ? c.paidInFull : c.awaitingCash}`);
  }

  // ── Payment method + date ──
  doc.moveDown(0.3);
  const method = booking.paymentMethod === 'wallet' ? c.methodOnline
    : booking.paymentMethod === 'card' ? c.methodCard
    : c.methodCash;
  labelLine(doc, c.paymentMethod, method);
  labelLine(doc, c.paymentDate, fmtDateOnly(booking.createdAt, lang));

  // ── Attestation ──
  sectionRule(doc);
  setFont(doc).fillColor(INK).fontSize(10).text(c.attestation(incubator.name ?? 'Metwork'), MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });

  // ── Stamp + footer ──
  drawStamp(doc, stampBuffer);
  drawFooter(doc, c, incubator.name ?? 'Metwork');

  return collectBuffer(doc);
}

/* ─────────────────── Payment-link receipt ─────────────────── */

export interface PaymentLinkReceiptInput {
  link:       PaymentLinkRecord;
  incubator:  ReceiptIncubator;
  lang:       ReceiptLang;
}

export async function generatePaymentLinkReceiptPdf(input: PaymentLinkReceiptInput): Promise<Buffer> {
  const { link, incubator, lang } = input;
  const c = COPY[lang];

  const amount = link.amount;
  const payerFee = link.payerFeeAmount ?? 0;
  const grossCharge = link.grossChargedToPayer ?? amount + payerFee;
  const reference = link.id.slice(0, 8).toUpperCase();
  const issuedOn = link.paidAt ?? link.createdAt;

  const [logoBuffer, stampBuffer] = await Promise.all([
    fetchImageBuffer(incubator.logoUrl),
    fetchImageBuffer(incubator.stampUrl),
  ]);

  const doc = makeDoc();

  drawLetterhead(doc, incubator, logoBuffer, lang);
  drawTitle(doc, c.receipt, reference, fmtDateOnly(issuedOn, lang), c);

  sectionRule(doc);
  sectionLabel(doc, c.receivedFrom);
  labelLine(doc, c.clientNameLabel, link.payerName ?? '—');
  if (link.payerEmail) labelLine(doc, c.email, link.payerEmail);

  sectionRule(doc);
  sectionLabel(doc, c.paymentDetails);
  drawDetailsTable(doc, c, [{
    service: link.serviceName + (link.description ? ` — ${link.description}` : ''),
    period:  fmtDateOnly(issuedOn, lang),
    amount:  amount.toLocaleString('fr-DZ').replace(/ | /g, ' '),
  }]);

  doc.moveDown(0.6);
  const totalY = doc.y;
  doc.rect(MARGIN, totalY, CONTENT_W, 38).fill(LIGHT);
  setFont(doc, { bold: true }).fillColor(DARK).fontSize(12).text(c.totalPaid, MARGIN + 14, totalY + 12, { width: 200 });
  setFont(doc, { bold: true }).fillColor(GREEN).fontSize(14).text(fmtMoney(grossCharge), MARGIN + 200, totalY + 11, { width: CONTENT_W - 214, align: 'right' });
  doc.y = totalY + 46;
  setFont(doc, { italic: true }).fillColor(GRAY).fontSize(9.5).text(`(${amountInWords(grossCharge, lang)} ${c.inWordsSuffix})`, MARGIN, doc.y, { width: CONTENT_W });

  if (payerFee > 0) {
    doc.moveDown(0.3);
    labelLine(doc, c.platformFee, `+ ${fmtMoney(payerFee)}`);
  }
  doc.moveDown(0.2);
  labelLine(doc, c.paymentMethod, c.methodCard);
  labelLine(doc, c.paymentDate, fmtDateOnly(issuedOn, lang));

  sectionRule(doc);
  setFont(doc).fillColor(INK).fontSize(10).text(c.attestation(incubator.name ?? 'Metwork'), MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });

  drawStamp(doc, stampBuffer);
  drawFooter(doc, c, incubator.name ?? 'Metwork');

  return collectBuffer(doc);
}

/* ─────────────────── Mentor consultation confirmation ─────────────────── */

export async function generateMentorConfirmationPdf(input: MentorConfirmationInput): Promise<Buffer> {
  const { booking, mentor, lang } = input;
  const c = COPY[lang];

  const feePerHour   = mentor.consultationFee ?? 0;
  const dur          = booking.durationMinutes ?? null;
  const estimatedFee = feePerHour > 0 && dur ? Math.round((dur / 60) * feePerHour) : null;

  const metworkLogo = await fetchImageBuffer(`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/Metworklogo.png`);

  const doc = makeDoc();

  // Letterhead: Metwork logo top-right + "Metwork · Mentor Network".
  drawLetterhead(doc, {
    name: 'Metwork', email: 'contact@metwork.dz', address: 'Mentor Network',
  }, metworkLogo, lang);

  drawTitle(doc, c.consultTitle, booking.id.slice(0, 8).toUpperCase(), fmtDateOnly(booking.createdAt, lang), c);

  sectionRule(doc);
  sectionLabel(doc, c.requestedBy);
  labelLine(doc, c.clientNameLabel, booking.userName);
  labelLine(doc, c.email, booking.userEmail);
  labelLine(doc, c.phone, booking.userPhone);

  sectionRule(doc);
  sectionLabel(doc, c.consultant);
  labelLine(doc, c.consultant, mentor.fullName);
  if (mentor.position) labelLine(doc, c.position, mentor.position);

  if (booking.scheduledAt) labelLine(doc, c.confirmedDate, fmtDate(booking.scheduledAt, lang));
  else if (booking.consultationDate) labelLine(doc, c.requestedDate, `${booking.consultationDate}${booking.consultationTime ? ` · ${booking.consultationTime}` : ''}`);
  if (dur) labelLine(doc, c.duration, `${dur} min`);
  if (booking.meetLink) labelLine(doc, c.meetingLink, booking.meetLink);
  else if (booking.isOffline) labelLine(doc, c.method, c.inPerson);

  const chargedAmount = typeof booking.amountCharged === 'number' ? booking.amountCharged : estimatedFee;
  if (booking.chargeType === 'FREE_QUOTA') labelLine(doc, c.method, c.freeCredit);
  else if (chargedAmount != null) labelLine(doc, c.amountPaid, chargedAmount === 0 ? c.free : fmtMoney(chargedAmount));

  // How it was paid — a generic label only. The receipt is DZD-only: an
  // international-card payment shows the same DZD figure as any other, with no
  // EUR amount, no exchange rate and no processor name.
  if (booking.chargeType !== 'FREE_QUOTA' && chargedAmount != null && chargedAmount > 0) {
    const methodLabel =
      booking.paymentProvider === 'STRIPE' ? c.methodInternationalCard
      : booking.paymentProvider === 'SLICKPAY' ? c.methodCard
      : booking.paymentProvider === 'CASH' ? c.methodCash
      : booking.paymentProvider === 'WALLET' ? c.methodOnline
      // Legacy records predate the field: a guest booking was always a direct
      // card charge, a registered one always came out of the wallet.
      : booking.source === 'guest' ? c.methodCard
      : c.methodOnline;
    labelLine(doc, c.paymentMethod, methodLabel);
  }

  sectionRule(doc);
  sectionLabel(doc, c.message);
  setFont(doc).fillColor(INK).fontSize(10).text(booking.message || '—', MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });

  if (booking.adminNote) {
    sectionRule(doc);
    sectionLabel(doc, c.teamNote);
    setFont(doc, { italic: true }).fillColor(INK).fontSize(10).text(booking.adminNote, MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });
  }

  doc.moveDown(0.6);
  setFont(doc, { italic: true }).fillColor(GRAY).fontSize(9.5).text(c.consultNote, MARGIN, doc.y, { width: CONTENT_W });

  drawFooter(doc, c, 'Metwork');
  return collectBuffer(doc);
}
