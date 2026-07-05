/**
 * Invoice PDF view model — ONE normalized shape consumed by every template.
 *
 * Pure presentation mapping of a stored InvoiceRecord: it formats the totals
 * via engine.formatDZD and localizes labels, but performs ZERO arithmetic —
 * the engine computed and froze `totals` / `amountInWords` at issue time and
 * they are rendered verbatim (legal immutability).
 */
import type { InvoiceRecord } from '@/server/db/store';
import { formatDZD, formatDZDWhole, lineAmountHt } from '@/server/invoices/engine';

export interface InvoiceViewModel {
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
  /** Espèce / Chèque / Virement bancaire. */
  paymentLabel: string;
  showTimbre: boolean;
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
  amountInWords: string;
  /** Footer contact items, empties omitted: [website, contactEmail, contactPhone]. */
  footerItems: Array<{ kind: 'website' | 'email' | 'phone'; value: string }>;
  cancelled: boolean;
}

const PAYMENT_LABELS: Record<InvoiceRecord['paymentMethod'], string> = {
  ESPECE: 'Espèce',
  CHEQUE: 'Chèque',
  VIREMENT: 'Virement bancaire',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
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

  const footerItems: InvoiceViewModel['footerItems'] = [];
  if (issuer.website?.trim()) footerItems.push({ kind: 'website', value: issuer.website.trim() });
  if (issuer.contactEmail?.trim()) footerItems.push({ kind: 'email', value: issuer.contactEmail.trim() });
  if (issuer.contactPhone?.trim()) footerItems.push({ kind: 'phone', value: issuer.contactPhone.trim() });

  return {
    number: invoice.number,
    date: fmtDate(invoice.issuedAt),
    issuerName: issuer.name,
    logoUrl: issuer.logoUrl ?? null,
    issuerLines,
    clientLines,
    paymentLabel: PAYMENT_LABELS[invoice.paymentMethod],
    showTimbre: invoice.paymentMethod === 'ESPECE',
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
    amountInWords: invoice.amountInWords,
    footerItems,
    cancelled: invoice.status === 'CANCELLED',
  };
}
