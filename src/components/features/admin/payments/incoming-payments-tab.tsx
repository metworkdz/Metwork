'use client';

/**
 * Incoming payments — every card or wallet payment collected through Metwork,
 * read from settlement records, with the figures an admin used to have to
 * assemble by hand. A row can open a refund request.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { IncomingRow, IncomingSummary } from '@/server/payments/incoming';
import { formatAmount, formatDate } from './types';

const STATUS_VARIANT = { PAID: 'success', REFUNDED: 'outline', REFUND_PENDING: 'warning' } as const;

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function IncomingPaymentsTab({ onOpenRefunds }: { onOpenRefunds: () => void }) {
  const t = useTranslations('refunds.admin');
  const [rows, setRows] = useState<IncomingRow[]>([]);
  const [summary, setSummary] = useState<IncomingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [target, setTarget] = useState<IncomingRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch('/api/admin/payments/incoming', { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { rows: IncomingRow[]; summary: IncomingSummary };
      setRows(data.rows);
      setSummary(data.summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openRefund() {
    if (!target) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch('/api/admin/refunds', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKind: target.kind, sourceId: target.id, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? t('errGeneric'));
      }
      setTarget(null);
      setReason('');
      onOpenRefunds();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">…</p>;
  if (error) return <InlineEmptyState title={t('loadError')} />;

  return (
    <div className="space-y-5">
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t('kpiCollected')} value={formatAmount(summary.collectedThisMonth)} hint={t('kpiCollectedHint')} />
          <Kpi label={t('kpiCommission')} value={formatAmount(summary.commissionThisMonth)} hint={t('kpiCommissionHint')} />
          <Kpi label={t('kpiOwed')} value={formatAmount(summary.owedToIncubators + summary.owedToConsultants)} hint={t('kpiOwedHint')} />
          <Kpi label={t('kpiRefunded')} value={formatAmount(summary.refundedThisMonth)} hint={t('kpiRefundedHint', { count: summary.openRefunds })} />
          {summary.consultantDebt > 0 && (
            <Kpi label={t('kpiDebt')} value={formatAmount(summary.consultantDebt)} hint={t('kpiDebtHint')} />
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState title={t('emptyIncoming')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colPayer')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead>{t('colPaidTo')}</TableHead>
                    <TableHead>{t('colChannel')}</TableHead>
                    <TableHead className="text-end">{t('colGross')}</TableHead>
                    <TableHead className="text-end">{t('colFee')}</TableHead>
                    <TableHead className="text-end">{t('colNet')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.kind}-${r.id}`}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.at)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.payer}</div>
                        <div className="text-xs text-muted-foreground">{r.guest ? t('guest') : t('registered')}{r.payerEmail ? ` · ${r.payerEmail}` : ''}</div>
                      </TableCell>
                      <TableCell>
                        <div>{r.item}</div>
                        {r.providerRef && <div className="font-mono text-xs text-muted-foreground">{r.providerRef}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{r.ownerName}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{t(`channel${r.channel}`)}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatAmount(r.gross)}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatAmount(r.fee)}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatAmount(r.net)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{t(`status${r.status}`)}</Badge></TableCell>
                      <TableCell>
                        {r.refundable && (
                          <Button size="sm" variant="outline" onClick={() => { setTarget(r); setReason(''); setFormError(null); }}>
                            {t('refund')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={target != null} onOpenChange={(o) => { if (!o && !busy) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('refund')} — {target ? formatAmount(target.gross) : ''}</DialogTitle>
            <DialogDescription>{target?.item} · {target?.payer}</DialogDescription>
          </DialogHeader>
          <Textarea
            id="refund-open-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('rejectReason')}
            rows={3}
          />
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>{t('cancel')}</Button>
            <Button disabled={busy || reason.trim().length < 3} onClick={() => void openRefund()}>
              {busy ? t('saving') : t('refund')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
