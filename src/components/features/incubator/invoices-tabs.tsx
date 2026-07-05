'use client';

/**
 * Invoices page shell — pill toggle between the legal invoices list
 * ("Factures", default) and the historical booking receipts ("Reçus").
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, ReceiptText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InvoiceList, type InvoiceListItem } from './invoice-list';
import { InvoicesManager } from './invoices-manager';
import type { BookingRecord } from '@/server/db/store';

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
  const [tab, setTab] = useState<'invoices' | 'receipts'>('invoices');

  const tabs = [
    { id: 'invoices' as const, label: t('tabInvoices'), icon: FileText, count: invoices.length },
    { id: 'receipts' as const, label: t('tabReceipts'), icon: ReceiptText, count: receipts.length },
  ];

  return (
    <div className="space-y-5">
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
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

      {tab === 'invoices'
        ? <InvoiceList initial={invoices} legalComplete={legalComplete} />
        : <InvoicesManager initial={receipts} />}
    </div>
  );
}
