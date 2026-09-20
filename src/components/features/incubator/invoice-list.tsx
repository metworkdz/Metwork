'use client';

/**
 * Document table — Numéro | Client | Date | Net à Payer | Mode | Statut
 * + actions (download PDF, cancel). Amounts are the STORED engine totals,
 * formatted with the same engine formatter as the PDF — never recomputed.
 *
 * One component for all three kinds: `kind` picks the copy and adds the
 * validity column, because a proforma and a devis expire and a facture does
 * not. Everything else is identical, and keeping it identical is the point.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Ban, Download, FilePlus2, FileText, Plus, Search } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatDZD } from '@/server/invoices/engine';
import type { InvoiceKind, InvoiceRecord } from '@/server/db/store';

export type InvoiceListItem = InvoiceRecord;

interface Props {
  kind: InvoiceKind;
  rows: InvoiceListItem[];
  legalComplete: boolean;
  /** The owner of the rows records the cancellation — see InvoicesTabs. */
  onCancelled: (id: string) => void;
}

const METHOD_LABEL_KEY = {
  ESPECE: 'methodEspece',
  CHEQUE: 'methodCheque',
  VIREMENT: 'methodVirement',
} as const;

/**
 * The message keys that differ per kind. Spelled out rather than built from a
 * suffix so a missing translation is a type error here, not a runtime gap in
 * front of a client.
 */
const COPY = {
  FACTURE: {
    create: 'createInvoice', emptyTitle: 'emptyTitle', emptyDescription: 'emptyDescription',
    emptyCta: 'emptyCta', actionCancel: 'actionCancel', confirmCancel: 'confirmCancel',
    statusIssued: 'statusIssued', statusCancelled: 'statusCancelled',
  },
  PROFORMA: {
    create: 'createProforma', emptyTitle: 'emptyProformaTitle', emptyDescription: 'emptyProformaDescription',
    emptyCta: 'emptyProformaCta', actionCancel: 'actionCancelProforma', confirmCancel: 'confirmCancelProforma',
    // "Facture proforma" is feminine too, so it shares the facture's labels.
    statusIssued: 'statusIssued', statusCancelled: 'statusCancelled',
  },
  DEVIS: {
    create: 'createQuote', emptyTitle: 'emptyQuoteTitle', emptyDescription: 'emptyQuoteDescription',
    emptyCta: 'emptyQuoteCta', actionCancel: 'actionCancelQuote', confirmCancel: 'confirmCancelQuote',
    // "Un devis" is masculine: "Émis", not "Émise".
    statusIssued: 'statusIssuedQuote', statusCancelled: 'statusCancelledQuote',
  },
} as const;

/** "YYYY-MM-DD" → "dd/mm/yyyy", without constructing a Date (no TZ shift). */
function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

export function InvoiceList({ kind, rows, legalComplete, onCancelled }: Props) {
  const t = useTranslations('incubator.invoicesPage');
  const copy = COPY[kind];
  const newHref = `/dashboard/incubator/invoices/new?kind=${kind}` as const;
  // A facture never expires; the other two do, and that date is the first
  // thing you look for when the client calls back three weeks later.
  const showValidity = kind !== 'FACTURE';
  const [q, setQ] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const filtered = q.trim()
    ? rows.filter((i) => {
        const needle = q.toLowerCase();
        const clientName = (i.clientSnapshot.legalName ?? i.clientSnapshot.name).toLowerCase();
        return i.number.toLowerCase().includes(needle) || clientName.includes(needle);
      })
    : rows;

  async function cancelInvoice(invoice: InvoiceListItem) {
    if (!confirm(t(copy.confirmCancel, { number: invoice.number }))) return;
    setCancellingId(invoice.id);
    try {
      const res = await fetch(`/api/incubator/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (res.ok) onCancelled(invoice.id);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {!legalComplete && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            {t('legalIncomplete')}{' '}
            <Link href="/dashboard/incubator/settings" className="font-medium underline underline-offset-2">
              {t('legalIncompleteLink')}
            </Link>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t('searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {legalComplete ? (
          <Button asChild>
            <Link href={newHref}>
              <Plus className="size-4" />
              {t(copy.create)}
            </Link>
          </Button>
        ) : (
          <Button disabled title={t('legalIncomplete')}>
            <Plus className="size-4" />
            {t(copy.create)}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title={q ? t('noMatches') : t(copy.emptyTitle)}
              description={q ? t('tryDifferentSearch') : t(copy.emptyDescription)}
              icon={<FileText className="size-5 text-muted-foreground" />}
              action={!q ? (
                <Button asChild size="sm" className="mt-1">
                  <Link href={newHref}>
                    <FilePlus2 className="size-4" />
                    {t(copy.emptyCta)}
                  </Link>
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colNumber')}</TableHead>
                    <TableHead>{t('colClient')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    {showValidity && <TableHead>{t('colValidUntil')}</TableHead>}
                    <TableHead className="text-end">{t('colNet')}</TableHead>
                    <TableHead>{t('colMethod')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((invoice) => {
                    const cancelled = invoice.status === 'CANCELLED';
                    return (
                      <TableRow key={invoice.id} className={cancelled ? 'opacity-60' : undefined}>
                        <TableCell className="font-medium tabular-nums">{invoice.number}</TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {invoice.clientSnapshot.legalName ?? invoice.clientSnapshot.name}
                          </div>
                          {invoice.clientSnapshot.legalName && (
                            <div className="text-xs text-muted-foreground">{invoice.clientSnapshot.name}</div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(invoice.issuedAt).toLocaleDateString('fr-DZ')}
                        </TableCell>
                        {showValidity && (
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {invoice.validUntil ? formatDay(invoice.validUntil) : '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-end tabular-nums font-medium">
                          {formatDZD(invoice.totals.net)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t(METHOD_LABEL_KEY[invoice.paymentMethod])}
                        </TableCell>
                        <TableCell>
                          {cancelled
                            ? <Badge variant="outline" className="border-destructive/40 text-destructive">{t(copy.statusCancelled)}</Badge>
                            : <Badge variant="outline" className="border-primary/40 text-primary">{t(copy.statusIssued)}</Badge>}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t('actionDownload')}
                              asChild
                            >
                              <a href={`/api/incubator/invoices/${invoice.id}/pdf`} download>
                                <Download className="size-4" />
                              </a>
                            </Button>
                            {!cancelled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t(copy.actionCancel)}
                                loading={cancellingId === invoice.id}
                                onClick={() => void cancelInvoice(invoice)}
                              >
                                <Ban className="size-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
