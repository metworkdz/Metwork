'use client';

/**
 * Invoices page shell — one tab per document kind (Factures, Proformas,
 * Devis) plus the historical booking receipts.
 *
 * The three document tabs are the SAME list component with a different kind:
 * they are the same records in the same table, and the only thing that varies
 * is the copy and which column makes sense. Splitting them into three
 * components is how they would drift apart.
 */
import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { formatInvoiceNumber } from '@/server/invoices/engine';
import { invoiceDayOf } from '@/lib/invoice-date';
import { useTranslations } from 'next-intl';
import { FileText, FileSignature, ReceiptText, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InvoiceList, type InvoiceListItem } from './invoice-list';
import { InvoicesManager } from './invoices-manager';
import type { BookingRecord, InvoiceKind } from '@/server/db/store';

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
};

interface Props {
  invoices: InvoiceListItem[];
  receipts: BookingWithCustomer[];
  legalComplete: boolean;
  /** A stamp is on file — the list offers the Cachet toggle only then. */
  hasStamp: boolean;
  /** The year the facture sequence counts in, resolved on the server. */
  factureYear: number;
  /** The facture counter's next value when the page loaded. */
  nextFactureSeq: number;
  /**
   * Every year's counters, as stored. A proforma converted with an earlier
   * date takes that year's number, so the preview needs more than this year.
   */
  invoiceCounters?: Record<string, number> | null;
  /** Booking receipts are an incubator thing; other issuers hide the tab. */
  showReceipts?: boolean;
}

export function InvoicesTabs({ invoices, receipts, legalComplete, hasStamp, factureYear, nextFactureSeq, invoiceCounters, showReceipts = true }: Props) {
  const t = useTranslations('incubator.invoicesPage');
  const [tab, setTab] = useState<InvoiceKind | 'receipts'>('FACTURE');
  /**
   * The rows live HERE, not in the list, because the list is remounted on
   * every tab switch. Kept below, a cancellation would be forgotten the
   * moment you looked at another tab and came back.
   */
  const [rows, setRows] = useState(invoices);
  const router = useRouter();

  const markCancelled = (id: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: 'CANCELLED' as const } : r)));
  /** A cancelled row was deleted; a proforma it had been converted from is unlocked again. */
  const markDeleted = (id: string, source: InvoiceListItem | null) => {
    setRows((rs) => rs
      .filter((r) => r.id !== id)
      .map((r) => (source && r.id === source.id ? source : r)));
    // The freed number changes the counters the page was loaded with.
    router.refresh();
  };
  /** A row the server rewrote (stamp, conversion) — or a new one (the facture a conversion created). */
  const upsert = (invoice: InvoiceListItem) =>
    setRows((rs) => (rs.some((r) => r.id === invoice.id)
      ? rs.map((r) => (r.id === invoice.id ? invoice : r))
      : [invoice, ...rs]));

  // Records issued before the other kinds existed carry no `kind` — they are
  // factures, and must keep showing up under Factures.
  const byKind = (kind: InvoiceKind) => rows.filter((i) => (i.kind ?? 'FACTURE') === kind);
  const factures = byKind('FACTURE');
  const proformas = byKind('PROFORMA');
  const devis = byKind('DEVIS');

  const tabs = [
    { id: 'FACTURE' as const, label: t('tabInvoices'), icon: FileText, count: factures.length },
    { id: 'PROFORMA' as const, label: t('tabProformas'), icon: ScrollText, count: proformas.length },
    { id: 'DEVIS' as const, label: t('tabQuotes'), icon: FileSignature, count: devis.length },
    ...(showReceipts ? [{ id: 'receipts' as const, label: t('tabReceipts'), icon: ReceiptText, count: receipts.length }] : []),
  ];

  const visible = tab === 'PROFORMA' ? proformas : tab === 'DEVIS' ? devis : factures;

  /** The number a conversion dated in `year` would take (a preview — the server allocates). */
  const factureNumberFor = (year: number) => {
    const counted = invoiceCounters?.[String(year)] ?? (year === factureYear ? nextFactureSeq - 1 : 0);
    // Factures converted since the page loaded have taken numbers too.
    const since = rows.filter(
      (r) => r.convertedFromId && r.year === year && !invoices.some((i) => i.id === r.id),
    ).length;
    return formatInvoiceNumber(counted + 1 + since, year, 'FACTURE');
  };
  /** The latest day already used by a live facture of `year` — numbering should stay chronological. */
  const latestFactureDay = (year: number): string | null =>
    factures
      .filter((f) => f.status !== 'CANCELLED' && f.year === year)
      .reduce<string | null>((max, f) => {
        const day = invoiceDayOf(f.issuedAt);
        return max === null || day > max ? day : max;
      }, null);

  return (
    <div className="space-y-5">
      {/* Four tabs don't fit one phone row — 2×2 there, a single row from sm. */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:inline-flex sm:flex-nowrap">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex min-h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-4',
              'basis-[calc(50%-0.125rem)] sm:basis-auto',
              tab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
            <span
              className={cn(
                'rounded-full px-1.5 text-xs tabular-nums',
                tab === id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'receipts'
        ? <InvoicesManager initial={receipts} />
        : (
          <InvoiceList
            key={tab}
            kind={tab}
            rows={visible}
            legalComplete={legalComplete}
            onCancelled={markCancelled}
            onDeleted={markDeleted}
            onChanged={upsert}
            hasStamp={hasStamp}
            factureNumberFor={factureNumberFor}
            latestFactureDay={latestFactureDay}
          />
        )}
    </div>
  );
}
