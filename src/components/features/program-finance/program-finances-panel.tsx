'use client';

/**
 * The « Finances » tab of a program: what it brought in, what it cost, what
 * is left — and the expenses behind it.
 *
 * Every figure comes from the server report (src/server/program-finance/
 * report.ts); this component only lays it out. Shared by the incubator
 * dashboard and the consultant portal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CheckCircle2, Download, FileSpreadsheet, Loader2, Paperclip, Pencil, PlusCircle, Receipt, Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Locale } from '@/i18n/config';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ProgramFinanceReport } from '@/server/program-finance/report';

import { CumulativeCurve, Waterfall, type WaterfallStep } from './finance-charts';
import { ProgramExpenseDialog, type ProgramExpense } from './program-expense-dialog';

interface Props {
  programId: string;
  apiBase: '/api/incubator/programs' | '/api/consultant/programs';
  uploadEndpoint: '/api/incubator/upload' | '/api/consultant/upload';
  uploadKind?: string;
}

interface Finances {
  program: { id: string; title: string; startDate: string; endDate: string; seatsTotal: number };
  report: ProgramFinanceReport;
  expenses: ProgramExpense[];
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

const INTL: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-DZ' };

export function ProgramFinancesPanel({ programId, apiBase, uploadEndpoint, uploadKind }: Props) {
  const t = useTranslations('programFinance');
  const locale = useLocale() as Locale;
  const base = `${apiBase}/${programId}/finances`;

  const [data, setData] = useState<Finances | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ProgramExpense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProgramExpense | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(await errorMessage(res, t('loadFailed')));
      setData(await res.json() as Finances);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('loadFailed'));
    }
  }, [base, t]);

  useEffect(() => { void load(); }, [load]);

  const money = useCallback((n: number) => formatCurrency(n, locale), [locale]);
  const signed = useCallback((n: number) => (n > 0 ? `−${money(n)}` : money(0)), [money]);
  const day = useCallback((iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(INTL[locale], {
    day: 'numeric', month: 'short', timeZone: 'Africa/Algiers',
  }), [locale]);
  const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 1000) / 10} %`);

  const steps = useMemo<WaterfallStep[]>(() => {
    if (!data) return [];
    const r = data.report;
    const afterCommission = r.collected - r.commission;
    return [
      { label: t('billed'), from: 0, to: r.billed, display: money(r.billed), tone: 'kept', total: true },
      { label: t('outstanding'), from: r.collected, to: r.billed, display: signed(r.outstanding), tone: 'owed' },
      { label: t('collected'), from: 0, to: r.collected, display: money(r.collected), tone: 'kept', total: true },
      { label: t('commission'), from: afterCommission, to: r.collected, display: signed(r.commission), tone: 'out' },
      { label: t('expenses'), from: r.netProfit, to: afterCommission, display: signed(r.expensesTotal), tone: 'out' },
      {
        label: t('netProfit'), from: 0, to: r.netProfit, display: money(r.netProfit),
        tone: r.netProfit < 0 ? 'out' : 'kept', total: true,
      },
    ];
  }, [data, money, signed, t]);

  async function exportFile(format: 'csv' | 'pdf') {
    setBusy(`export:${format}`);
    setActionError(null);
    try {
      const res = await fetch(`${base}/export?format=${format}&lang=${locale}`, { credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('exportFailed')));
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `rapport.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('exportFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(`delete:${deleting.id}`);
    setActionError(null);
    try {
      const res = await fetch(`${base}/expenses/${deleting.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('deleteFailed')));
      setDeleting(null);
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('deleteFailed'));
      setDeleting(null);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</p>;
  }
  if (!data) {
    return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  }

  const r = data.report;
  const hasMoney = r.billed > 0 || r.expensesTotal > 0;
  const signups = r.timeline.map((p) => ({ date: p.date, value: p.cumulativeSignups, delta: p.signups }));
  const cash = r.timeline.filter((p) => p.cumulativeCollected > 0 || p.collected > 0)
    .map((p) => ({ date: p.date, value: p.cumulativeCollected, delta: p.collected }));
  const breakEvenReached = r.breakEvenParticipants != null && r.payingParticipants >= r.breakEvenParticipants;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" loading={busy === 'export:csv'}
            disabled={Boolean(busy)} onClick={() => void exportFile('csv')}>
            <FileSpreadsheet className="size-4" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" loading={busy === 'export:pdf'}
            disabled={Boolean(busy)} onClick={() => void exportFile('pdf')}>
            <Download className="size-4" /> PDF
          </Button>
        </div>
      </div>

      {actionError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>
      )}

      {/* Key figures — net profit first, it is the answer */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">{t('netProfit')}</p>
          <p className={cn('mt-1 text-3xl font-bold tabular-nums tracking-tight', r.netProfit < 0 ? 'text-destructive' : 'text-foreground')}>
            <span dir="ltr">{money(r.netProfit)}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('marginLine', { margin: pct(r.margin) })}
            {r.outstanding > 0 && <> · {t('projectedLine', { amount: money(r.projectedProfit) })}</>}
          </p>
        </div>
        <Kpi label={t('collected')} value={money(r.collected)} note={t('ofBilled', { amount: money(r.billed) })} />
        <Kpi label={t('expenses')} value={money(r.expensesTotal)} note={t('expenseCount', { count: data.expenses.length })} />
        <Kpi label={t('outstanding')} value={money(r.outstanding)} note={r.outstanding > 0 ? t('outstandingNote') : t('nothingOwed')} />
      </div>

      {!hasMoney && (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      )}

      {/* From billed to profit */}
      {hasMoney && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">{t('waterfallTitle')}</h3>
          <Waterfall steps={steps} ariaLabel={t('waterfallTitle')} />
          <p className="text-xs text-muted-foreground">{t('waterfallHint')}</p>
        </section>
      )}

      {/* Curves — two measures, two charts */}
      {r.timeline.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">{t('signupsTitle')}</h3>
            <CumulativeCurve
              points={signups}
              format={(n) => String(n)}
              formatDate={day}
              ariaLabel={t('signupsAria', { count: r.participants })}
              deltaLabel={(d) => t('signupsDelta', { count: d })}
            />
          </section>
          <section className="space-y-2 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">{t('cashTitle')}</h3>
            {cash.length > 0 ? (
              <CumulativeCurve
                points={cash}
                format={money}
                formatDate={day}
                ariaLabel={t('cashAria', { amount: money(r.collected) })}
                deltaLabel={(d) => t('cashDelta', { amount: d })}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('noCashYet')}</p>
            )}
          </section>
        </div>
      )}

      {/* Participants and unit economics */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('peopleTitle')}</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label={t('participants')} value={String(r.participants)}
            note={t('payingFree', { paying: r.payingParticipants, free: r.freeParticipants })} />
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">{t('fillRate')}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{pct(r.fillRate)}</p>
            {r.fillRate != null && (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-[#1b7e40] dark:bg-[#1d9a6c]" style={{ width: `${Math.min(100, r.fillRate * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('seatsLine', { taken: r.participants, total: r.seatsTotal })}</p>
              </>
            )}
          </div>
          <Kpi label={t('averageTicket')} value={r.averageTicket == null ? '—' : money(r.averageTicket)} note={t('averageTicketNote')} />
          <Kpi label={t('costPerParticipant')} value={r.costPerParticipant == null ? '—' : money(r.costPerParticipant)} note={t('costPerParticipantNote')} />
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">{t('breakEven')}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {r.breakEvenParticipants == null ? '—' : t('breakEvenValue', { count: r.breakEvenParticipants })}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              {r.breakEvenParticipants == null ? t('breakEvenUnknown')
                : breakEvenReached ? <><CheckCircle2 className="size-3.5 text-primary" /> {t('breakEvenReached')}</>
                : t('breakEvenMissing', { count: r.breakEvenParticipants - r.payingParticipants })}
            </p>
          </div>
          <Kpi label={t('absent')} value={String(r.absent)} note={t('absentNote')} />
        </div>
      </section>

      {/* Takings by payment method */}
      {r.byChannel.length > 0 && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">{t('channelsTitle')}</h3>
          <ul className="space-y-2">
            {r.byChannel.map((c) => (
              <li key={c.channel} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{t(`channel${c.channel}`)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-[#1b7e40] dark:bg-[#1d9a6c]"
                    style={{ width: `${(c.amount / Math.max(1, r.collected)) * 100}%` }} />
                </span>
                <span className="tabular-nums" dir="ltr">{money(c.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Expenses */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('expensesTitle')}</h3>
          <Button size="sm" className="gap-1.5" onClick={() => setDialog('new')}>
            <PlusCircle className="size-4" /> {t('addExpense')}
          </Button>
        </div>
        {r.expensesByCategory.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {r.expensesByCategory.map((c) => (
              <span key={c.category ?? '—'} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {c.category ?? t('uncategorized')} · <span className="tabular-nums" dir="ltr">{money(c.amount)}</span>
              </span>
            ))}
          </div>
        )}
        {data.expenses.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <Receipt className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('noExpenses')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.title}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{day(e.date)}</span>
                    {e.category && <span>· {e.category}</span>}
                    {e.receiptUrl && (
                      <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Paperclip className="size-3" /> {t('receipt')}
                      </a>
                    )}
                  </p>
                </div>
                <span className="whitespace-nowrap font-medium tabular-nums" dir="ltr">{signed(e.amount)}</span>
                <Button size="icon" variant="ghost" className="size-9" aria-label={t('editExpenseNamed', { title: e.title })}
                  onClick={() => setDialog(e)}>
                  <Pencil className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" className="size-9 text-muted-foreground hover:text-destructive"
                  aria-label={t('deleteExpenseNamed', { title: e.title })} onClick={() => setDeleting(e)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {apiBase === '/api/incubator/programs' && (
          <p className="text-xs text-muted-foreground">{t('ledgerHint')}</p>
        )}
      </section>

      <ProgramExpenseDialog
        target={dialog}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        endpoint={`${base}/expenses`}
        uploadEndpoint={uploadEndpoint}
        uploadKind={uploadKind}
        onSaved={() => void load()}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{deleting ? t('deleteBody', { title: deleting.title, amount: money(deleting.amount) }) : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
            <Button variant="destructive" loading={Boolean(deleting && busy === `delete:${deleting.id}`)}
              onClick={() => void confirmDelete()}>
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums"><span dir="ltr">{value}</span></p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
