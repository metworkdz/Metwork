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
}

export function InvoicesTabs({ invoices, receipts, legalComplete }: Props) {
  const t = useTranslations('incubator.invoicesPage');
  const [tab, setTab] = useState<InvoiceKind | 'receipts'>('FACTURE');
  /**
   * The rows live HERE, not in the list, because the list is remounted on
   * every tab switch. Kept below, a cancellation would be forgotten the
   * moment you looked at another tab and came back.
   */
  const [rows, setRows] = useState(invoices);

  const markCancelled = (id: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: 'CANCELLED' as const } : r)));

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
    { id: 'receipts' as const, label: t('tabReceipts'), icon: ReceiptText, count: receipts.length },
  ];

  const visible = tab === 'PROFORMA' ? proformas : tab === 'DEVIS' ? devis : factures;

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
          />
        )}
    </div>
  );
}
