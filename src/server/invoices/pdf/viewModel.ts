/**
 * Invoice PDF view model — ONE normalized shape consumed by every template.
 *
 * Pure presentation mapping of a stored InvoiceRecord: it formats the totals
 * via engine.formatDZD and localizes labels, but performs ZERO arithmetic —
 * the engine computed and froze `totals` / `amountInWords` at issue time and
 * they are rendered verbatim (legal immutability).
 */
import type { InvoiceKind, InvoiceRecord } from '@/server/db/store';
import { formatDZD, formatDZDWhole, lineAmountHt } from '@/server/invoices/engine';

export interface InvoiceViewModel {
  kind: InvoiceKind;
  /** Big heading: "FACTURE", "FACTURE PROFORMA", "DEVIS". */
  title: string;
  /** "NN/YYYY". */
  number: string;
  /** "dd/mm/yyyy". */
  date: string;
  /** Issuer display name (letterhead + attestation). */
  issuerName: string;
  logoUrl: string | null;
  /** Right-aligned legal block lines, empties already omitted. */
  issuerLines: string[];
  /** "Déstinataire" block lines, empties already omitted (name first). */
  clientLines: string[];
  /**
   * "Mode de Paiement", or "Paiement prévu" when nothing is due yet. Kept
   * short: on the CLASSIC template this label lives in a 123pt column beside
   * the number, and a longer one wraps to two lines.
   */
  paymentTitle: string;
  /** Espèce / Chèque / Virement bancaire. */
  paymentLabel: string;
  /**
   * Whether to draw the droit de timbre row at all. False on a proforma and a
   * devis — an ABSENT row, not a zero: a "0,00 DA" line still asserts the duty
   * was considered and settled, which on a document nobody has paid is untrue.
   */
  showTimbre: boolean;
  /**
   * What this document is, in its own words — the "ne vaut pas facture"
   * disclaimer, the validity date. Empty for a facture.
   */
  notices: string[];
  /** A devis is signed back; a facture and a proforma are not. */
  showAcceptance: boolean;
  /**
   * The issuer's stamp to print, or null when this document was issued
   * without one. Read off the FROZEN snapshot, never from settings.
   */
  stampUrl: string | null;
  /** The host's own note for this document, trimmed; null when empty. */
  note: string | null;
  /**
   * Issuer bank details ("Banque : …", "RIB : …") — non-empty only when the
   * payment method is VIREMENT, so a transfer invoice always tells the client
   * where to pay.
   */
  bankLines: string[];
  lines: Array<{
    designation: string;
    quantity: string;
    amountHt: string;
    vat: string; // "19%"
  }>;
  totals: {
    ht: string;
    tva: string;
    ttc: string;
    timbre: string;
    net: string;
  };
  /** "Arrêtée la présente facture …" / "… le présent devis …". */
  amountInWordsLabel: string;
  amountInWords: string;
  /** Footer contact items, empties omitted: [website, contactEmail, contactPhone]. */
  footerItems: Array<{ kind: 'website' | 'email' | 'phone'; value: string }>;
  cancelled: boolean;
  /** ANNULÉE for the two feminine documents, ANNULÉ for a devis. */
  cancelledLabel: string;
}

const PAYMENT_LABELS: Record<InvoiceRecord['paymentMethod'], string> = {
  ESPECE: 'Espèce',
  CHEQUE: 'Chèque',
  VIREMENT: 'Virement bancaire',
};

const TITLES: Record<InvoiceKind, string> = {
  FACTURE: 'FACTURE',
  PROFORMA: 'FACTURE PROFORMA',
  DEVIS: 'DEVIS',
};

/**
 * "Arrêtée la présente facture à la somme de :" is a fixed legal formula on a
 * facture. The other two documents get the same formula, agreeing with what
 * they actually are — a devis is masculine, hence "Arrêté le présent devis".
 */
const WORDS_LABELS: Record<InvoiceKind, string> = {
  FACTURE: 'Arrêtée la présente facture à la somme de :',
  PROFORMA: 'Arrêtée la présente facture proforma à la somme de :',
  DEVIS: 'Arrêté le présent devis à la somme de :',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** "YYYY-MM-DD" → "dd/mm/yyyy"; anything unparseable is returned untouched. */
function fmtDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

/** Push "LABEL: value" (or bare value) only when the value is non-empty. */
function pushLine(out: string[], value: string | null | undefined, label?: string): void {
  const v = (value ?? '').trim();
  if (!v) return;
  out.push(label ? `${label}: ${v}` : v);
}

export function buildInvoiceViewModel(invoice: InvoiceRecord): InvoiceViewModel {
  const issuer = invoice.issuerSnapshot;
  const client = invoice.clientSnapshot;
  // Absent on every record issued before the other two kinds existed.
  const kind = invoice.kind ?? 'FACTURE';

  const issuerLines: string[] = [];
  pushLine(issuerLines, issuer.name);
  pushLine(issuerLines, issuer.address);
  pushLine(issuerLines, issuer.rc, 'RCN');
  pushLine(issuerLines, issuer.nif, 'NIF');
  pushLine(issuerLines, issuer.nis, 'NIS');
  pushLine(issuerLines, issuer.ai, 'Art N');

  const clientLines: string[] = [];
  if (client.clientType === 'COMPANY') {
    pushLine(clientLines, client.legalName ?? client.name);
    pushLine(clientLines, client.address);
    pushLine(clientLines, client.rc, 'RC');
    pushLine(clientLines, client.nif, 'NIF');
    pushLine(clientLines, client.nis, 'NIS');
    pushLine(clientLines, client.ai, 'AI');
    pushLine(clientLines, client.phone, 'N TEL');
  } else {
    pushLine(clientLines, client.name);
    pushLine(clientLines, client.address);
    pushLine(clientLines, client.phone, 'N TEL');
    pushLine(clientLines, client.email);
  }

  const bankLines: string[] = [];
  if (invoice.paymentMethod === 'VIREMENT') {
    pushLine(bankLines, issuer.bankName, 'Banque');
    pushLine(bankLines, issuer.bankRib, 'RIB');
  }

  /**
   * Retitling the page is not enough: without this line the only thing telling
   * a proforma apart from a facture is one word in a heading, and sooner or
   * later somebody files the wrong document.
   */
  const notices: string[] = [];
  if (kind === 'PROFORMA') {
    notices.push("Ce document n'est pas une facture et ne vaut pas pièce comptable.");
  }
  if (invoice.validUntil) {
    notices.push(
      kind === 'DEVIS'
        ? `Devis valable jusqu'au ${fmtDay(invoice.validUntil)}.`
        : `Offre valable jusqu'au ${fmtDay(invoice.validUntil)}.`,
    );
  }

  const footerItems: InvoiceViewModel['footerItems'] = [];
  if (issuer.website?.trim()) footerItems.push({ kind: 'website', value: issuer.website.trim() });
  if (issuer.contactEmail?.trim()) footerItems.push({ kind: 'email', value: issuer.contactEmail.trim() });
  if (issuer.contactPhone?.trim()) footerItems.push({ kind: 'phone', value: issuer.contactPhone.trim() });

  const note = invoice.note?.trim();

  return {
    kind,
    title: TITLES[kind],
    // An absent `withStamp` is a document issued before the choice existed —
    // those were printed without a stamp, and re-downloading one must not
    // silently start adding it.
    stampUrl: invoice.withStamp ? (issuer.stampUrl ?? null) : null,
    note: note ? note : null,
    number: invoice.number,
    date: fmtDate(invoice.issuedAt),
    issuerName: issuer.name,
    logoUrl: issuer.logoUrl ?? null,
    issuerLines,
    clientLines,
    paymentTitle: kind === 'FACTURE' ? 'Mode de Paiement' : 'Paiement prévu',
    paymentLabel: PAYMENT_LABELS[invoice.paymentMethod],
    // Mirrors computeStampDuty: no timbre on a document nobody has paid.
    showTimbre: kind === 'FACTURE' && invoice.paymentMethod === 'ESPECE',
    notices,
    showAcceptance: kind === 'DEVIS',
    bankLines,
    lines: invoice.lines.map((l) => ({
      designation: l.designation,
      quantity: String(l.quantity),
      amountHt: formatDZDWhole(lineAmountHt(l)),
      vat: `${invoice.vatRate}%`,
    })),
    totals: {
      ht: formatDZD(invoice.totals.ht),
      tva: formatDZD(invoice.totals.tva),
      ttc: formatDZD(invoice.totals.ttc),
      timbre: formatDZD(invoice.totals.timbre),
      net: formatDZD(invoice.totals.net),
    },
    amountInWordsLabel: WORDS_LABELS[kind],
    amountInWords: invoice.amountInWords,
    footerItems,
    cancelled: invoice.status === 'CANCELLED',
    cancelledLabel: kind === 'DEVIS' ? 'ANNULÉ' : 'ANNULÉE',
  };
}
