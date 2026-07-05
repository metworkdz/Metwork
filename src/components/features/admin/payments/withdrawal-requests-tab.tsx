'use client';

/**
 * Withdrawal Requests — user + mentor requests merged into one list with
 * colour-coded status pills. [Approve] settles the escrow hold after the admin
 * has moved the money manually (bank wire / CCP / cheque); [Reject] refunds
 * the held amount. Both PATCH the existing admin endpoints (idempotent
 * server-side, so a double-click can never double-debit).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { cn } from '@/lib/utils';
import type { RequestRow, StatusPillKind } from './types';
import { formatAmount, formatDate, statusPillOf, MODAL_CONTENT_CLASS } from './types';

interface RawUserRow {
  id: string; userId: string; userName: string; amount: number; balance: number;
  status: RequestRow['status']; method?: RequestRow['method'];
  destinationAccountSnapshot?: RequestRow['destinationAccountSnapshot'];
  accountDetails: string; receiptUrl?: string | null; createdAt: string;
}
interface RawMentorRow {
  id: string; mentorId: string; mentorName: string; amount: number; availableBalance: number;
  status: RequestRow['status']; method?: RequestRow['method'];
  destinationAccountSnapshot?: RequestRow['destinationAccountSnapshot'];
  accountDetails: string; receiptUrl?: string | null; createdAt: string;
}

type Action = { kind: 'approve' | 'reject'; row: RequestRow };

export function WithdrawalRequestsTab() {
  const t = useTranslations('admin.payments');
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [uRes, mRes] = await Promise.all([
        fetch('/api/admin/withdrawals', { credentials: 'include' }),
        fetch('/api/admin/mentor-withdrawals', { credentials: 'include' }),
      ]);
      if (!uRes.ok || !mRes.ok) throw new Error('Failed to load withdrawal requests');
      const u = await uRes.json() as { items: RawUserRow[] };
      const m = await mRes.json() as { items: RawMentorRow[] };
      const merged: RequestRow[] = [
        ...u.items.map((r): RequestRow => ({
          id: r.id, targetType: 'user', targetId: r.userId, name: r.userName, amount: r.amount,
          balance: r.balance, status: r.status, method: r.method,
          destinationAccountSnapshot: r.destinationAccountSnapshot,
          accountDetails: r.accountDetails, receiptUrl: r.receiptUrl, createdAt: r.createdAt,
        })),
        ...m.items.map((r): RequestRow => ({
          id: r.id, targetType: 'mentor', targetId: r.mentorId, name: r.mentorName, amount: r.amount,
          balance: r.availableBalance, status: r.status, method: r.method,
          destinationAccountSnapshot: r.destinationAccountSnapshot,
          accountDetails: r.accountDetails, receiptUrl: r.receiptUrl, createdAt: r.createdAt,
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRows(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function open(kind: Action['kind'], row: RequestRow) {
    setAction({ kind, row });
    setNote('');
    setActionError(null);
  }

  async function submit() {
    if (!action) return;
    setBusy(true);
    setActionError(null);
    try {
      const base = action.row.targetType === 'user' ? '/api/admin/withdrawals' : '/api/admin/mentor-withdrawals';
      const res = await fetch(`${base}/${action.row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action.kind === 'approve' ? 'APPROVED' : 'REJECTED',
          adminNote: note || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Action failed');
      }
      setAction(null);
      setNote('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card><CardContent className="h-40 animate-pulse" /></Card>;
  if (error) return <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>;

  const isApprove = action?.kind === 'approve';

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title={t('requests.emptyTitle')}
              description={t('requests.emptyDescription')}
              icon={<Banknote className="size-5 text-muted-foreground" />}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('requests.colUser')}</TableHead>
                      <TableHead className="text-end">{t('requests.colAmount')}</TableHead>
                      <TableHead>{t('requests.colMethod')}</TableHead>
                      <TableHead>{t('requests.colStatus')}</TableHead>
                      <TableHead>{t('requests.colDate')}</TableHead>
                      <TableHead className="w-44" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={`${r.targetType}-${r.id}`}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums">{formatAmount(r.amount)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{methodLabel(r, t)}</TableCell>
                        <TableCell><StatusPill row={r} t={t} /></TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                        <TableCell><RowActions row={r} onAct={open} t={t} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 p-4 md:hidden">
                {rows.map((r) => (
                  <div key={`${r.targetType}-${r.id}`} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-sm font-semibold tabular-nums">{formatAmount(r.amount)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <StatusPill row={r} t={t} />
                      <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{methodLabel(r, t)}</p>
                    <div className="mt-3"><RowActions row={r} onAct={open} t={t} stacked /></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Approve / Reject confirmation */}
      <Dialog open={action !== null} onOpenChange={(o) => { if (!o) setAction(null); }}>
        <DialogContent className={cn('max-w-sm', MODAL_CONTENT_CLASS)}>
          <DialogHeader>
            <DialogTitle>{isApprove ? t('requests.approveTitle') : t('requests.rejectTitle')}</DialogTitle>
            <DialogDescription>
              {isApprove
                ? t('requests.approveBody', { amount: formatAmount(action?.row.amount ?? 0) })
                : t('requests.rejectBody', { amount: formatAmount(action?.row.amount ?? 0) })}
            </DialogDescription>
          </DialogHeader>
          {isApprove && action && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{t('requests.destination')}</p>
              <p className="mt-1 break-all">{action.row.accountDetails || methodLabel(action.row, t)}</p>
            </div>
          )}
          <Textarea
            className="text-sm"
            rows={2}
            placeholder={t('requests.notePlaceholder')}
            value={note}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
          />
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>{t('cancel')}</Button>
            <Button variant={isApprove ? 'default' : 'destructive'} loading={busy} onClick={submit}>
              {isApprove ? t('requests.approve') : t('requests.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function methodLabel(r: RequestRow, t: ReturnType<typeof useTranslations>): string {
  return r.method ? t(`requests.methodLabel.${r.method}`) : t('requests.methodLabel.legacy');
}

const PILL_VARIANT: Record<StatusPillKind, 'success' | 'warning' | 'outline'> = {
  requested: 'warning',
  approved: 'success',
  rejected: 'outline',
};

function StatusPill({ row, t }: { row: RequestRow; t: ReturnType<typeof useTranslations> }) {
  const pill = statusPillOf(row);
  return <Badge variant={PILL_VARIANT[pill]}>{t(`requests.pill.${pill}`)}</Badge>;
}

function RowActions({
  row, onAct, t, stacked,
}: {
  row: RequestRow;
  onAct: (kind: 'approve' | 'reject', row: RequestRow) => void;
  t: ReturnType<typeof useTranslations>;
  stacked?: boolean;
}) {
  if (row.status !== 'PENDING') return null;
  return (
    <div className={cn('flex gap-2', stacked && 'grid grid-cols-2')}>
      <Button variant="default" size="sm" onClick={() => onAct('approve', row)}>
        <CheckCircle2 className="size-3.5" /> {t('requests.approve')}
      </Button>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => onAct('reject', row)}>
        <XCircle className="size-3.5" /> {t('requests.reject')}
      </Button>
    </div>
  );
}
