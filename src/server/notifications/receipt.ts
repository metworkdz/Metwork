/**
 * PDF receipt generator.
 *
 * Produces an A4 PDF buffer for:
 *  - Standard bookings   (space / program / event)  → full payment receipt
 *  - Mentor consultations                           → request confirmation
 *  - Manual / offline bookings                      → same as standard
 *
 * Uses pdfkit (pure Node.js, no native deps — works on Vercel serverless).
 * Language: 'en' or 'fr'. Arabic falls back to French.
 */
import PDFDocument from 'pdfkit';
import type { BookingRecord, IncubatorRecord, MentorBookingRecord, MentorRecord } from '@/server/db/store';

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

export interface BookingReceiptInput {
  booking:      BookingRecord;
  /** Display name of the client (platform user or offline client). */
  clientName:   string;
  /** Email we are sending to — shown on the receipt. */
  clientEmail:  string;
  incubator:    Pick<IncubatorRecord, 'name' | 'email' | 'phone' | 'city' | 'logoUrl' | 'stampUrl' | 'address' | 'registrationNumber'>;
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

type LangKey =
  | 'receipt'      | 'confirmation'   | 'receiptNo'
  | 'issuedOn'     | 'billedTo'       | 'bookingDetails'
  | 'type'         | 'item'           | 'from'
  | 'to'           | 'unit'           | 'quantity'
  | 'payment'      | 'paymentMethod'  | 'status'
  | 'total'        | 'free'           | 'online'
  | 'cash'         | 'confirmed'      | 'pending'
  | 'pendingPaymt' | 'hour'           | 'day'
  | 'month'        | 'half_day'       | 'halfDaily'
  | 'space'        | 'program'
  | 'event'        | 'hourly'         | 'daily'
  | 'monthly'      | 'thankYou'       | 'consultTitle'
  | 'consultRef'   | 'consultMessage' | 'requestedBy'
  | 'phone'        | 'consultant'     | 'requested'
  | 'consultNote'
  | 'depositReceipt' | 'card'         | 'depositPaid'
  | 'cashBalance'    | 'paidInFull'   | 'awaitingCashPay'
  | 'platformFee'    | 'chargedOnline';

const T: Record<ReceiptLang, Record<LangKey, string>> = {
  en: {
    receipt:       'RECEIPT',
    confirmation:  'BOOKING CONFIRMATION',
    receiptNo:     'Receipt #',
    issuedOn:      'Issued on',
    billedTo:      'BILLED TO',
    bookingDetails:'BOOKING DETAILS',
    type:          'Type',
    item:          'Item',
    from:          'From',
    to:            'To',
    unit:          'Billing unit',
    quantity:      'Quantity',
    payment:       'PAYMENT',
    paymentMethod: 'Method',
    status:        'Status',
    total:         'TOTAL',
    free:          'Free',
    online:        'Online (wallet)',
    cash:          'Cash on-site',
    confirmed:     'Confirmed',
    pending:       'Pending',
    pendingPaymt:  'Pending payment (cash)',
    hour:          'hour',
    day:           'day',
    month:         'month',
    half_day:      'half-day',
    halfDaily:     'Half-day',
    space:         'Space',
    program:       'Program',
    event:         'Event',
    hourly:        'Hourly',
    daily:         'Daily',
    monthly:       'Monthly',
    thankYou:      'Thank you for your booking. This receipt is your proof of payment.',
    consultTitle:  'CONSULTATION REQUEST CONFIRMED',
    consultRef:    'Reference #',
    consultMessage:'Your message',
    requestedBy:   'Requested by',
    phone:         'Phone',
    consultant:    'Consultant',
    requested:     'Requested on',
    consultNote:   'Our team will contact you shortly to confirm the appointment.',
    depositReceipt:'DEPOSIT RECEIPT',
    card:          'Card (CIB / Edahabia)',
    depositPaid:   'Deposit paid (card)',
    cashBalance:   'Balance (cash on-site)',
    paidInFull:    'Paid in full',
    awaitingCashPay:'Awaiting cash on-site',
    platformFee:   'Platform fee',
    chargedOnline: 'Charged online (card)',
  },
  fr: {
    receipt:       'REÇU',
    confirmation:  'CONFIRMATION DE RÉSERVATION',
    receiptNo:     'Reçu n°',
    issuedOn:      'Émis le',
    billedTo:      'FACTURÉ À',
    bookingDetails:'DÉTAILS DE LA RÉSERVATION',
    type:          'Type',
    item:          'Prestation',
    from:          'Du',
    to:            'Au',
    unit:          'Unité de facturation',
    quantity:      'Quantité',
    payment:       'PAIEMENT',
    paymentMethod: 'Mode',
    status:        'Statut',
    total:         'TOTAL',
    free:          'Gratuit',
    online:        'En ligne (portefeuille)',
    cash:          'Espèces sur place',
    confirmed:     'Confirmé',
    pending:       'En attente',
    pendingPaymt:  'En attente de paiement (espèces)',
    hour:          'heure',
    day:           'jour',
    month:         'mois',
    half_day:      'demi-journée',
    halfDaily:     'Demi-journée',
    space:         'Espace',
    program:       'Programme',
    event:         'Événement',
    hourly:        'Horaire',
    daily:         'Journalier',
    monthly:       'Mensuel',
    thankYou:      'Merci pour votre réservation. Ce reçu constitue votre preuve de paiement.',
    consultTitle:  'DEMANDE DE CONSULTATION CONFIRMÉE',
    consultRef:    'Référence n°',
    consultMessage:'Votre message',
    requestedBy:   'Demandé par',
    phone:         'Téléphone',
    consultant:    'Consultant',
    requested:     'Demandé le',
    consultNote:   'Notre équipe vous contactera prochainement pour confirmer le rendez-vous.',
    depositReceipt:'REÇU D’ACOMPTE',
    card:          'Carte (CIB / Edahabia)',
    depositPaid:   'Acompte payé (carte)',
    cashBalance:   'Solde (espèces sur place)',
    paidInFull:    'Payé intégralement',
    awaitingCashPay:'En attente d’espèces sur place',
    platformFee:   'Frais de plateforme',
    chargedOnline: 'Débité en ligne (carte)',
  },
};

/* ─────────────────── Image fetcher ─────────────────── */

/**
 * Fetch a remote image URL and return its raw bytes as a Buffer.
 * Returns null on any network / decode error so callers can gracefully skip.
 */
async function fetchImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
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

const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN    = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

const GREEN  = '#166534';
const DARK   = '#09090b';
const GRAY   = '#71717a';
const LIGHT  = '#f4f4f5';
const WHITE  = '#ffffff';

/* ─────────────────── Helpers ─────────────────── */

function fmt(n: number): string {
  return n.toLocaleString('fr-DZ') + ' DZD';
}

function fmtDate(iso: string, lang: ReceiptLang): string {
  try {
    return new Date(iso).toLocaleString(lang === 'fr' ? 'fr-DZ' : 'en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

function fmtDateOnly(iso: string, lang: ReceiptLang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-DZ' : 'en-GB', {
      day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/* ─────────────────── PDF builder ─────────────────── */

function makeDoc(): InstanceType<typeof PDFDocument> {
  return new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Creator: 'Metwork', Producer: 'Metwork' },
  });
}

async function collectBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/* ─────────────────── Header (green bar + incubator logo/name) ────────── */

/**
 * Draws the green header band.
 *
 * Layout (left → right inside the 495-pt content area):
 *   [logo 80×80 px]  [incubator name + city]
 *
 * If logoBuffer is null the name occupies the full width.
 */
function drawHeader(
  doc: InstanceType<typeof PDFDocument>,
  incubator: BookingReceiptInput['incubator'],
  logoBuffer: Buffer | null,
): void {
  const HEADER_H = 90;

  // Green header band
  doc.rect(0, 0, PAGE_W, HEADER_H).fill(GREEN);

  const LOGO_SIZE  = 64; // rendered size in points
  const LOGO_PAD   = 13; // vertical padding inside band
  const TEXT_LEFT  = logoBuffer ? MARGIN + LOGO_SIZE + 16 : MARGIN;
  const TEXT_WIDTH = logoBuffer ? CONTENT_W - LOGO_SIZE - 16 : CONTENT_W;

  // Incubator logo (top-left, vertically centred in the band)
  if (logoBuffer) {
    try {
      const logoY = LOGO_PAD;
      doc.image(logoBuffer, MARGIN, logoY, {
        width:  LOGO_SIZE,
        height: LOGO_SIZE,
        fit:    [LOGO_SIZE, LOGO_SIZE],
        align:  'center',
        valign: 'center',
      });
    } catch {
      // Logo could not be embedded — fall through to text-only
    }
  }

  // Incubator name
  doc
    .fillColor(WHITE)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(incubator.name, TEXT_LEFT, 22, { width: TEXT_WIDTH, lineBreak: false });

  // City / tagline
  if (incubator.city) {
    doc
      .fillColor(WHITE)
      .font('Helvetica')
      .fontSize(10)
      .text(incubator.city, TEXT_LEFT, 46, { width: TEXT_WIDTH });
  }

  doc.moveDown(0);
}

/* ─────────────────── Incubator sub-header (contact line) ─────────────── */

function drawIncubatorContact(
  doc: InstanceType<typeof PDFDocument>,
  incubator: BookingReceiptInput['incubator'],
  lang: ReceiptLang,
): void {
  const parts: string[] = [];
  if (incubator.address)            parts.push(incubator.address);
  if (incubator.phone)              parts.push(incubator.phone);
  if (incubator.email)              parts.push(incubator.email);
  if (incubator.registrationNumber) parts.push(`RC: ${incubator.registrationNumber}`);

  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(9)
    .text(parts.join('  •  '), MARGIN, 100, { width: CONTENT_W });

  void lang; // may be used later for RTL
  doc.moveDown(0.5);
}

/* ─────────────────── Divider ─────────────────── */

function drawDivider(doc: InstanceType<typeof PDFDocument>): void {
  const y = doc.y + 6;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#e4e4e7').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

/* ─────────────────── Section label ─────────────────── */

function drawSectionLabel(doc: InstanceType<typeof PDFDocument>, label: string): void {
  doc
    .fillColor(GREEN)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(label.toUpperCase(), MARGIN, doc.y + 6);
  doc.moveDown(0.3);
}

/* ─────────────────── Two-column row ─────────────────── */

function drawRow(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
  value: string,
  opts: { bold?: boolean; large?: boolean } = {},
): void {
  const y   = doc.y;
  const col = MARGIN + 160;
  const fs  = opts.large ? 13 : 10;
  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(fs)
    .text(label, MARGIN, y, { width: 155, continued: false });

  doc
    .fillColor(opts.bold ? DARK : '#3f3f46')
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(fs)
    .text(value, col, y, { width: CONTENT_W - 160 });

  doc.moveDown(0.1);
}

/* ─────────────────── Receipt title block ─────────────────── */

function drawReceiptTitle(
  doc: InstanceType<typeof PDFDocument>,
  t: Record<LangKey, string>,
  reference: string,
  issuedOn: string,
  lang: ReceiptLang,
  title: string = t.receipt,
): void {
  doc.moveDown(0.8);
  doc
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(title, MARGIN, doc.y);

  doc.moveDown(0.4);
  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(10)
    .text(`${t.receiptNo}${reference}  ·  ${t.issuedOn} ${fmtDateOnly(issuedOn, lang)}`);

  drawDivider(doc);
}

/* ─────────────────── Status box ─────────────────── */

function statusLabel(
  status: BookingRecord['status'],
  t: Record<LangKey, string>,
): string {
  switch (status) {
    case 'CONFIRMED':       return t.confirmed;
    case 'PENDING':         return t.pending;
    case 'PENDING_PAYMENT': return t.pendingPaymt;
    default:                return status;
  }
}

function paymentLabel(
  method: BookingRecord['paymentMethod'],
  t: Record<LangKey, string>,
): string {
  if (method === 'wallet') return t.online;
  if (method === 'manual') return t.cash;
  if (method === 'card') return t.card;
  return '—';
}

function kindLabel(kind: BookingRecord['itemKind'], t: Record<LangKey, string>): string {
  switch (kind) {
    case 'SPACE':   return t.space;
    case 'PROGRAM': return t.program;
    case 'EVENT':   return t.event;
  }
}

function unitLabel(unit: BookingRecord['unit'], t: Record<LangKey, string>): string {
  switch (unit) {
    case 'HOUR':     return t.hourly;
    case 'HALF_DAY': return t.halfDaily;
    case 'DAY':      return t.daily;
    case 'MONTH':    return t.monthly;
  }
}

/* ─────────────────── Stamp ─────────────────── */

/**
 * Draws an official-looking stamp near the bottom-right of the page.
 *
 * Priority:
 *   1. stampBuffer  — incubator's real stamp image (rendered at 90 × 90 pt)
 *   2. Vector stamp — green circular "CONFIRMED" badge (fallback)
 */
function drawStamp(
  doc: InstanceType<typeof PDFDocument>,
  stampBuffer: Buffer | null,
  label = 'CONFIRMED',
): void {
  const STAMP_SIZE = 90;
  const cx = PAGE_W - MARGIN - STAMP_SIZE / 2;
  const cy = PAGE_H - MARGIN - STAMP_SIZE / 2 - 20;

  doc.save();

  if (stampBuffer) {
    try {
      doc.image(stampBuffer, cx - STAMP_SIZE / 2, cy - STAMP_SIZE / 2, {
        width:  STAMP_SIZE,
        height: STAMP_SIZE,
        fit:    [STAMP_SIZE, STAMP_SIZE],
        align:  'center',
        valign: 'center',
      });
      doc.restore();
      return;
    } catch {
      // Fall through to vector stamp
    }
  }

  // Vector fallback — double-ring circular stamp
  const r = 44;
  doc.circle(cx, cy, r).strokeColor(GREEN).lineWidth(2.5).stroke();
  doc.circle(cx, cy, r - 7).strokeColor(GREEN).lineWidth(0.8).stroke();
  doc
    .fillColor(GREEN)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(label, cx - r + 6, cy - 5, { width: (r - 6) * 2, align: 'center' });

  doc.restore();
}

/* ─────────────────── Footer ─────────────────── */

function drawFooter(
  doc: InstanceType<typeof PDFDocument>,
  t: Record<LangKey, string>,
  incubatorName: string,
): void {
  // Background strip at the bottom
  const stripY = PAGE_H - 60;
  doc
    .rect(0, stripY, PAGE_W, 60)
    .fill(LIGHT);

  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(8)
    .text(t.thankYou, MARGIN, stripY + 12, { width: CONTENT_W });

  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(8)
    .text(
      `© ${new Date().getFullYear()} ${incubatorName}  ·  Powered by Metwork`,
      MARGIN, stripY + 28,
      { width: CONTENT_W },
    );
}

/* ─────────────────── Main: booking receipt ─────────────────── */

/**
 * Generates an A4 PDF buffer for a standard booking (space / program / event)
 * or a manual / offline booking.
 */
export async function generateBookingReceiptPdf(input: BookingReceiptInput): Promise<Buffer> {
  const { booking, clientName, clientEmail, incubator, lang } = input;
  const t = T[lang];

  // Card CASH_DEPOSIT bookings carry a deposit/balance split. The variant
  // controls the title; the split rows are driven directly by the frozen
  // server-side booking amounts so the receipt can never disagree with the
  // ledger. Default to 'standard' for legacy wallet / manual bookings.
  const isCashDeposit = booking.paymentMode === 'CASH_DEPOSIT';
  const variant: ReceiptVariant = input.variant ?? (isCashDeposit
    ? (booking.paymentStatus === 'PAID' ? 'final' : 'deposit')
    : 'standard');
  const onlinePaid = booking.onlinePaidAmount ?? 0;
  const cashBalance = booking.cashRemainingAmount ?? 0;
  const payerFee = booking.payerFeeAmount ?? 0;

  // Pre-fetch images in parallel (non-blocking — failures return null)
  const [logoBuffer, stampBuffer] = await Promise.all([
    fetchImageBuffer(incubator.logoUrl),
    fetchImageBuffer(incubator.stampUrl),
  ]);

  const doc = makeDoc();

  // ── Header ──
  drawHeader(doc, incubator, logoBuffer);
  drawIncubatorContact(doc, incubator, lang);

  // ── Receipt title ──
  drawReceiptTitle(
    doc, t, booking.clientReference, booking.createdAt, lang,
    variant === 'deposit' ? t.depositReceipt : t.receipt,
  );

  // ── Billed to ──
  drawSectionLabel(doc, t.billedTo);
  doc.moveDown(0.2);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(clientName, MARGIN, doc.y);
  doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(clientEmail, MARGIN, doc.y);
  if (booking.notes) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(booking.notes, MARGIN, doc.y);
  }
  drawDivider(doc);

  // ── Booking details ──
  drawSectionLabel(doc, t.bookingDetails);
  doc.moveDown(0.2);
  drawRow(doc, t.type, kindLabel(booking.itemKind, t));
  drawRow(doc, t.item, booking.itemName, { bold: true });
  drawRow(doc, t.from, fmtDate(booking.startsAt, lang));
  drawRow(doc, t.to,   fmtDate(booking.endsAt,   lang));
  if (booking.itemKind === 'SPACE') {
    drawRow(doc, t.unit,     unitLabel(booking.unit, t));
    drawRow(doc, t.quantity, `${booking.quantity} ${t[booking.unit.toLowerCase() as 'hour' | 'half_day' | 'day' | 'month']}`);
  }
  drawDivider(doc);

  // ── Payment ──
  drawSectionLabel(doc, t.payment);
  doc.moveDown(0.2);
  drawRow(doc, t.paymentMethod, paymentLabel(booking.paymentMethod, t));
  if (isCashDeposit) {
    // Deposit / balance split for CASH_DEPOSIT card bookings.
    drawRow(doc, t.depositPaid, fmt(onlinePaid), { bold: true });
    // Payer-side platform fee charged on top of the deposit (when applied).
    if (payerFee > 0) drawRow(doc, t.platformFee, `+ ${fmt(payerFee)}`);
    drawRow(
      doc,
      t.cashBalance,
      variant === 'final'
        ? `${fmt(cashBalance)} — ${t.paidInFull}`
        : `${fmt(cashBalance)} — ${t.awaitingCashPay}`,
    );
  } else {
    // Payer-side platform fee charged on top of the online payment (when applied).
    if (payerFee > 0) drawRow(doc, t.platformFee, `+ ${fmt(payerFee)}`);
    drawRow(doc, t.status, statusLabel(booking.status, t));
  }
  drawDivider(doc);

  // ── Total (highlighted row) ──
  const totalY = doc.y + 8;
  doc.rect(MARGIN, totalY, CONTENT_W, 36).fill(LIGHT);
  const totalStr = booking.totalAmount === 0 ? t.free : fmt(booking.totalAmount);
  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(11)
    .text(t.total, MARGIN + 12, totalY + 11, { width: 150 });
  doc
    .fillColor(GREEN)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(totalStr, MARGIN + 160, totalY + 8, { width: CONTENT_W - 172, align: 'right' });

  doc.y = totalY + 50;

  // ── Stamp when confirmed ──
  if (booking.status === 'CONFIRMED') {
    drawStamp(doc, stampBuffer);
  }

  // ── Footer ──
  drawFooter(doc, t, incubator.name);

  return collectBuffer(doc);
}

/* ─────────────────── Mentor consultation confirmation ─────────────────── */

/**
 * Generates an A4 confirmation PDF for an approved mentor consultation.
 * Includes booking reference, mentor details, scheduled date/time, duration, and estimated fee.
 */
export async function generateMentorConfirmationPdf(input: MentorConfirmationInput): Promise<Buffer> {
  const { booking, mentor, lang } = input;
  const t = T[lang];

  // Compute estimated fee from mentor hourly rate × duration
  const feePerHour   = mentor.consultationFee ?? 0;
  const dur          = booking.durationMinutes ?? null;
  const estimatedFee = feePerHour > 0 && dur
    ? Math.round((dur / 60) * feePerHour)
    : null;

  // Pre-fetch the Metwork logo for the consultation header
  const metworkLogoBuffer = await fetchImageBuffer(`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/Metworkwhitelogo.png`);

  const doc = makeDoc();

  // ── Header ──
  const HEADER_H = 90;
  doc.rect(0, 0, PAGE_W, HEADER_H).fill(GREEN);

  if (metworkLogoBuffer) {
    try {
      doc.image(metworkLogoBuffer, MARGIN, 13, {
        width: 120, height: 64, fit: [120, 64], align: 'center', valign: 'center',
      });
    } catch { /* skip logo on error */ }
    doc
      .fillColor(WHITE)
      .font('Helvetica')
      .fontSize(10)
      .text('Mentor Network', MARGIN + 136, 46);
  } else {
    doc
      .fillColor(WHITE)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('Metwork', MARGIN, 28);
    doc.fillColor(WHITE).font('Helvetica').fontSize(10).text('Mentor Network', MARGIN, 52);
  }
  doc.moveDown(0);

  // ── Title ──
  doc.moveDown(1.5);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(16).text(t.consultTitle, MARGIN, doc.y);
  doc.moveDown(0.4);
  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(10)
    .text(`${t.consultRef}${booking.id.slice(0, 8).toUpperCase()}  ·  ${t.requested} ${fmtDateOnly(booking.createdAt, lang)}`);

  drawDivider(doc);

  // ── Requester details ──
  drawSectionLabel(doc, t.requestedBy);
  doc.moveDown(0.2);
  drawRow(doc, t.requestedBy, booking.userName,  { bold: true });
  drawRow(doc, 'Email',       booking.userEmail);
  drawRow(doc, t.phone,       booking.userPhone);
  drawDivider(doc);

  // ── Consultant ──
  drawSectionLabel(doc, t.consultant);
  doc.moveDown(0.2);
  drawRow(doc, t.consultant, mentor.fullName,  { bold: true });
  drawRow(doc, 'Position',    mentor.position);
  drawDivider(doc);

  // ── Consultation details (schedule, duration, fee) ──
  const hasDetails = booking.scheduledAt || booking.consultationDate || dur || estimatedFee !== null;
  if (hasDetails) {
    const detailsLabel = lang === 'fr' ? 'DÉTAILS DU RENDEZ-VOUS' : 'APPOINTMENT DETAILS';
    drawSectionLabel(doc, detailsLabel);
    doc.moveDown(0.2);

    // Confirmed scheduled date (set by admin on approval) takes priority over requested date
    if (booking.scheduledAt) {
      const schedLabel = lang === 'fr' ? 'Date confirmée' : 'Confirmed date';
      drawRow(doc, schedLabel, fmtDate(booking.scheduledAt, lang), { bold: true });
    } else if (booking.consultationDate) {
      const dateLabel = lang === 'fr' ? 'Date demandée' : 'Requested date';
      const timeStr   = booking.consultationTime ? ` à ${booking.consultationTime}` : '';
      drawRow(doc, dateLabel, `${booking.consultationDate}${timeStr}`);
    }

    if (dur) {
      const durLabel = lang === 'fr' ? 'Durée' : 'Duration';
      drawRow(doc, durLabel, `${dur} min`);
    }

    if (booking.meetLink) {
      const linkLabel = lang === 'fr' ? 'Lien de réunion' : 'Meeting link';
      drawRow(doc, linkLabel, booking.meetLink);
    } else if (booking.isOffline) {
      const modeLabel = lang === 'fr' ? 'Mode' : 'Mode';
      drawRow(doc, modeLabel, lang === 'fr' ? 'Présentiel' : 'In-person');
    }

    // ── Amount charged ──────────────────────────────────────────────────
    // Prefer the persisted booking.amountCharged (set authoritatively when
    // the wallet was debited) over the locally re-computed `estimatedFee`.
    // The "estimated" wording is reserved for the legacy code path where
    // no chargeType was recorded — every recent booking has one.
    const chargedAmount = typeof booking.amountCharged === 'number'
      ? booking.amountCharged
      : estimatedFee;

    if (booking.chargeType === 'FREE_QUOTA') {
      const feeLabel = lang === 'fr' ? 'Mode de paiement' : 'Payment method';
      drawRow(
        doc,
        feeLabel,
        lang === 'fr' ? 'Crédit mensuel gratuit' : 'Free monthly credit',
        { bold: true },
      );
    } else if (chargedAmount !== null && chargedAmount !== undefined) {
      // PAID: show the real amount that was debited from the user's wallet.
      const feeLabel = booking.chargeType === 'PAID'
        ? (lang === 'fr' ? 'Montant payé' : 'Amount paid')
        : (lang === 'fr' ? 'Frais estimés' : 'Estimated fee');
      drawRow(
        doc,
        feeLabel,
        chargedAmount === 0 ? t.free : fmt(chargedAmount),
        { bold: true },
      );
      if (booking.chargeType === 'PAID' && chargedAmount > 0) {
        const methodLabel = lang === 'fr' ? 'Méthode' : 'Method';
        drawRow(doc, methodLabel, lang === 'fr' ? 'Portefeuille Metwork' : 'Metwork wallet');
      }
    }

    if (booking.appliedPromoCode) {
      const promoLabel = lang === 'fr' ? 'Code promo appliqué' : 'Promo applied';
      const discount   = booking.promoDiscountPercent ? ` (−${booking.promoDiscountPercent}%)` : '';
      drawRow(doc, promoLabel, `${booking.appliedPromoCode}${discount}`);
    }

    drawDivider(doc);
  }

  // ── Message ──
  drawSectionLabel(doc, t.consultMessage);
  doc.moveDown(0.2);
  doc
    .fillColor('#3f3f46')
    .font('Helvetica')
    .fontSize(10)
    .text(booking.message, MARGIN, doc.y, { width: CONTENT_W, align: 'left' });

  drawDivider(doc);

  // ── Admin note (if any) ──
  if (booking.adminNote) {
    const noteLabel = lang === 'fr' ? 'NOTE DE L\'ÉQUIPE' : 'TEAM NOTE';
    drawSectionLabel(doc, noteLabel);
    doc.moveDown(0.2);
    doc
      .fillColor('#3f3f46')
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text(booking.adminNote, MARGIN, doc.y, { width: CONTENT_W });
    drawDivider(doc);
  }

  // ── Note ──
  doc.moveDown(0.4);
  doc
    .fillColor(GRAY)
    .font('Helvetica-Oblique')
    .fontSize(10)
    .text(t.consultNote, MARGIN, doc.y, { width: CONTENT_W });

  // ── Confirmed stamp ──
  drawStamp(doc, null);

  // ── Footer ──
  drawFooter(doc, t, 'Metwork');

  return collectBuffer(doc);
}
