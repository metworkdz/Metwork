/**
 * Canonical invoice calculation + numbering engine — the SINGLE source of
 * truth for invoice money math. The API route computes and STORES the results
 * on the InvoiceRecord at issue time; the UI and the PDF layer read the stored
 * values verbatim and must never recompute them.
 *
 * Everything here is pure and unit-testable (src/__tests__/invoice-engine.test.ts),
 * except allocateInvoiceNumber which mutates the passed incubator record and is
 * documented to run only inside db.update().
 */
import type { IncubatorRecord, InvoiceLine, InvoicePaymentMethod } from '@/server/db/store';
import { amountInWords } from '@/server/notifications/amount-words';

/**
 * Round to 2 decimals (money in DZD). Uses the decimal exponent shift instead
 * of `n * 100` so half-centime values that decimal arithmetic intends as .xx5
 * (stored in binary as .xx49999…) round UP as an accountant expects:
 * 19.005 → "19.005e2" → 1900.5 → 19.01 (whereas 19.005 * 100 = 1900.49999…).
 */
export function round2(n: number): number {
  const shifted = Math.round(Number(`${n}e2`));
  return Number(`${shifted}e-2`);
}

export interface InvoiceTotals {
  ht: number;
  tva: number;
  ttc: number;
  timbre: number;
  net: number;
}

/**
 * Droit de timbre (stamp duty) on cash payments.
 *
 * LEGAL ASSUMPTION (change here only): applies to ESPECE payments exclusively,
 * as a percentage of the TTC, per bracket:
 *   TTC ≤ 30 000 DZD   → 1 %
 *   TTC ≤ 100 000 DZD  → 1.5 %
 *   TTC > 100 000 DZD  → 2 %
 * rounded to the whole dinar. NOTE: the statutory 5 DZD minimum per receipt is
 * intentionally NOT applied (product decision 2026-07); add it here if the
 * accountant requires it.
 */
export function computeStampDuty(ttc: number, paymentMethod: InvoicePaymentMethod): number {
  if (paymentMethod !== 'ESPECE') return 0;
  const rate = ttc <= 30_000 ? 0.01 : ttc <= 100_000 ? 0.015 : 0.02;
  return Math.round(ttc * rate);
}

/** Row amount HT for one line — also used by the PDF layer for row display. */
export function lineAmountHt(line: InvoiceLine): number {
  return round2(line.quantity * line.unitPriceHt);
}

/**
 * Compute every stored total from the line items.
 *   ht     = Σ quantity × unitPriceHt
 *   tva    = round2(ht × vatRate / 100)
 *   ttc    = ht + tva
 *   timbre = computeStampDuty(ttc, paymentMethod)
 *   net    = ttc + timbre
 */
export function computeInvoiceTotals(
  lines: InvoiceLine[],
  vatRate: number,
  paymentMethod: InvoicePaymentMethod,
): InvoiceTotals {
  const ht = round2(lines.reduce((s, l) => s + l.quantity * l.unitPriceHt, 0));
  const tva = round2((ht * vatRate) / 100);
  const ttc = round2(ht + tva);
  const timbre = computeStampDuty(ttc, paymentMethod);
  const net = round2(ttc + timbre);
  return { ht, tva, ttc, timbre, net };
}

/**
 * Format a DZD amount without decimals when it is whole: "24 000 DA"
 * (2 decimals kept otherwise). Used for table rows, matching the official
 * template; totals always use formatDZD's ",00".
 */
export function formatDZDWhole(n: number): string {
  if (Number.isInteger(n)) {
    const grouped = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${n < 0 ? '-' : ''}${grouped} DA`;
  }
  return formatDZD(n);
}

/**
 * Format a DZD amount for display: "28 560,00 DA" — non-breaking-space
 * thousands separator, comma decimals, always 2 decimals.
 */
export function formatDZD(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(2).split('.') as [string, string];
  //   = no-break space, so "28 560,00 DA" never wraps mid-amount.
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped},${dec} DA`;
}

/**
 * Spell an amount for the "Arrêtée la présente facture à la somme de :" line.
 * Reuses the receipt words engine (single French-words implementation in the
 * codebase), uppercased with hyphens flattened to spaces, e.g.
 *   28560 → "VINGT HUIT MILLE CINQ CENT SOIXANTE DINARS"
 * Centimes (when the net has decimals) are appended as "ET … CENTIMES".
 */
export function amountToFrenchWords(net: number): string {
  const abs = Math.abs(net);
  const dinars = Math.floor(abs);
  const centimes = Math.round((abs - dinars) * 100);
  const up = (n: number) => amountInWords(n, 'fr').toUpperCase().replace(/-/g, ' ');
  let out = `${up(dinars)} DINARS`;
  if (centimes > 0) out += ` ET ${up(centimes)} CENTIMES`;
  return out;
}

/** "NN/YYYY" — seq zero-padded to at least 2 digits. */
export function formatInvoiceNumber(seq: number, year: number): string {
  return `${String(seq).padStart(2, '0')}/${year}`;
}

/**
 * Allocate the next invoice number for `year`, mutating
 * `incubator.invoiceCounters` in place.
 *
 * MUST be called inside the SAME db.update() transaction that appends the
 * InvoiceRecord — the store's serialized write queue is what guarantees two
 * concurrent creates can neither collide nor skip a number.
 *
 * `requestedSeq` lets the incubator override the number on creation (also how
 * a custom starting range works, e.g. first invoice at "07/2026"): the counter
 * jumps to max(current, requestedSeq) so the next auto number continues after
 * it. Callers are responsible for rejecting a requestedSeq already used by an
 * existing invoice of the same incubator + year.
 */
export function allocateInvoiceNumber(
  incubator: IncubatorRecord,
  year: number,
  requestedSeq?: number,
): { number: string; seq: number } {
  const counters = incubator.invoiceCounters ?? {};
  const current = counters[String(year)] ?? 0;
  const seq = requestedSeq ?? current + 1;
  counters[String(year)] = Math.max(current, seq);
  incubator.invoiceCounters = counters;
  return { number: formatInvoiceNumber(seq, year), seq };
}
