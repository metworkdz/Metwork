'use client';

/**
 * Legal invoices table — Numéro | Client | Date | Net à Payer | Mode | Statut
 * + actions (download PDF, cancel). Amounts are the STORED engine totals,
 * formatted with the same engine formatter as the PDF — never recomputed.
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
import type { InvoiceRecord } from '@/server/db/store';

export type InvoiceListItem = InvoiceRecord;

interface Props {
  initial: InvoiceListItem[];
  legalComplete: boolean;
}

const METHOD_LABEL_KEY = {
  ESPECE: 'methodEspece',
  CHEQUE: 'methodCheque',
  VIREMENT: 'methodVirement',
} as const;

export function InvoiceList({ initial, legalComplete }: Props) {
  const t = useTranslations('incubator.invoicesPage');
  const [rows, setRows] = useState(initial);
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
    if (!confirm(t('confirmCancel', { number: invoice.number }))) return;
    setCancellingId(invoice.id);
    try {
      const res = await fetch(`/api/incubator/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (res.ok) {
        setRows((rs) => rs.map((r) => r.id === invoice.id ? { ...r, status: 'CANCELLED' as const } : r));
      }
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
            <Link href="/dashboard/incubator/invoices/new">
              <Plus className="size-4" />
              {t('createInvoice')}
            </Link>
          </Button>
        ) : (
          <Button disabled title={t('legalIncomplete')}>
            <Plus className="size-4" />
            {t('createInvoice')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title={q ? t('noMatches') : t('emptyTitle')}
              description={q ? t('tryDifferentSearch') : t('emptyDescription')}
              icon={<FileText className="size-5 text-muted-foreground" />}
              action={!q ? (
                <Button asChild size="sm" className="mt-1">
                  <Link href="/dashboard/incubator/invoices/new">
                    <FilePlus2 className="size-4" />
                    {t('emptyCta')}
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
                        <TableCell className="text-end tabular-nums font-medium">
                          {formatDZD(invoice.totals.net)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t(METHOD_LABEL_KEY[invoice.paymentMethod])}
                        </TableCell>
                        <TableCell>
                          {cancelled
                            ? <Badge variant="outline" className="border-destructive/40 text-destructive">{t('statusCancelled')}</Badge>
                            : <Badge variant="outline" className="border-primary/40 text-primary">{t('statusIssued')}</Badge>}
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
                                title={t('actionCancel')}
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
