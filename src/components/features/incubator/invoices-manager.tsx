'use client';

/**
 * Invoices manager — list of all paid bookings with a "Print receipt" action.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ReceiptText, Search, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { ReceiptModal } from './receipt-modal';
import type { BookingRecord } from '@/server/db/store';

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
};

interface Props {
  initial: BookingWithCustomer[];
}

export function InvoicesManager({ initial }: Props) {
  const t = useTranslations('incubator.invoicesManager');
  const [q, setQ] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const filtered = q.trim()
    ? initial.filter(
        (b) =>
          b.customerName.toLowerCase().includes(q.toLowerCase()) ||
          b.customerEmail.toLowerCase().includes(q.toLowerCase()) ||
          b.itemName.toLowerCase().includes(q.toLowerCase()),
      )
    : initial;

  const totalRevenue = initial.reduce((s, b) => s + b.totalAmount, 0);

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{t('totalInvoiced')}</p>
          <p className="text-2xl font-bold tabular-nums">{totalRevenue.toLocaleString()} DZD</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('receiptsCount', { count: initial.length })}</p>
      </div>

      <Card>
        <div className="border-b border-border/60 px-5 py-3">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t('searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title={q ? t('noMatches') : t('emptyTitle')}
              description={q ? t('tryDifferentSearch') : t('emptyDescription')}
              icon={<ReceiptText className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCustomer')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead>{t('colKind')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="text-end">{t('colAmount')}</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.customerName}</div>
                        <div className="text-xs text-muted-foreground">{b.customerEmail}</div>
                      </TableCell>
                      <TableCell className="font-medium">{b.itemName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {b.itemKind.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(b.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">
                        {b.totalAmount === 0 ? (
                          <span className="text-muted-foreground">{t('free')}</span>
                        ) : (
                          `${b.totalAmount.toLocaleString()} DZD`
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('printReceipt')}
                          onClick={() => setReceiptId(b.id)}
                        >
                          <Printer className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {receiptId && (
        <ReceiptModal bookingId={receiptId} onClose={() => setReceiptId(null)} />
      )}
    </>
  );
}
