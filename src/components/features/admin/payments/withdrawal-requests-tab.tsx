'use client';

/**
 * Withdrawal Requests tab — user + mentor requests merged into one list with
 * colour-coded status pills. [Process] opens the New Transfer modal pre-filled
 * with the requester + requested amount; [Reject] refunds the held amount.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, Send, XCircle } from 'lucide-react';
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
import type { BankAccountMasked, PayoutPill, RequestRow } from './types';
import { formatAmount, formatDate, payoutPillOf, MODAL_CONTENT_CLASS } from './types';

interface WithdrawalRequestsTabProps {
  refreshKey: number;
  onProcess: (row: RequestRow) => void;
}

interface RawUserRow {
  id: string; userId: string; userName: string; amount: number; balance: number;
  status: RequestRow['status']; payoutStatus?: RequestRow['payoutStatus']; payoutFailureReason?: string | null;
  bankAccount: BankAccountMasked | null; createdAt: string;
}
interface RawMentorRow {
  id: string; mentorId: string; mentorName: string; amount: number; availableBalance: number;
  status: RequestRow['status']; payoutStatus?: RequestRow['payoutStatus']; payoutFailureReason?: string | null;
  bankAccount: BankAccountMasked | null; createdAt: string;
}

export function WithdrawalRequestsTab({ refreshKey, onProcess }: WithdrawalRequestsTabProps) {
  const t = useTranslations('admin.payments');
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<RequestRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

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
          balance: r.balance, status: r.status, payoutStatus: r.payoutStatus, payoutFailureReason: r.payoutFailureReason,
          bankAccount: r.bankAccount, createdAt: r.createdAt,
        })),
        ...m.items.map((r): RequestRow => ({
          id: r.id, targetType: 'mentor', targetId: r.mentorId, name: r.mentorName, amount: r.amount,
          balance: r.availableBalance, status: r.status, payoutStatus: r.payoutStatus, payoutFailureReason: r.payoutFailureReason,
          bankAccount: r.bankAccount, createdAt: r.createdAt,
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRows(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function submitReject() {
    if (!rejecting) return;
    setBusy(true);
    setRejectError(null);
    try {
      const base = rejecting.targetType === 'user' ? '/api/admin/withdrawals' : '/api/admin/mentor-withdrawals';
      const res = await fetch(`${base}/${rejecting.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED', adminNote: note || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Reject failed');
      }
      setRejecting(null);
      setNote('');
      await load();
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card><CardContent className="h-40 animate-pulse" /></Card>;
  if (error) return <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>;

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
                        <TableCell><StatusPill row={r} t={t} /></TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                        <TableCell><RowActions row={r} onProcess={onProcess} onReject={setRejecting} t={t} /></TableCell>
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
                    <div className="mt-3"><RowActions row={r} onProcess={onProcess} onReject={setRejecting} t={t} stacked /></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Reject confirmation */}
      <Dialog open={rejecting !== null} onOpenChange={(o) => { if (!o) setRejecting(null); }}>
        <DialogContent className={cn('max-w-sm', MODAL_CONTENT_CLASS)}>
          <DialogHeader>
            <DialogTitle>{t('requests.rejectTitle')}</DialogTitle>
            <DialogDescription>{t('requests.rejectBody', { amount: formatAmount(rejecting?.amount ?? 0) })}</DialogDescription>
          </DialogHeader>
          <Textarea
            className="text-sm"
            rows={2}
            placeholder={t('requests.notePlaceholder')}
            value={note}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
          />
          {rejectError && <p className="text-xs text-destructive">{rejectError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={busy}>{t('cancel')}</Button>
            <Button variant="destructive" loading={busy} onClick={submitReject}>{t('requests.reject')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const PILL_VARIANT: Record<PayoutPill, 'success' | 'warning' | 'danger' | 'outline'> = {
  requested: 'warning',
  processing: 'outline',
  sent: 'success',
  failed: 'danger',
  rejected: 'outline',
};

function StatusPill({ row, t }: { row: RequestRow; t: ReturnType<typeof useTranslations> }) {
  const pill = payoutPillOf(row);
  return (
    <div className="space-y-1">
      <Badge variant={PILL_VARIANT[pill]}>{t(`requests.pill.${pill}`)}</Badge>
      {pill === 'failed' && row.payoutFailureReason && (
        <p className="max-w-[22ch] truncate text-[11px] text-muted-foreground" title={row.payoutFailureReason}>
          {row.payoutFailureReason}
        </p>
      )}
    </div>
  );
}

function RowActions({
  row, onProcess, onReject, t, stacked,
}: {
  row: RequestRow;
  onProcess: (r: RequestRow) => void;
  onReject: (r: RequestRow) => void;
  t: ReturnType<typeof useTranslations>;
  stacked?: boolean;
}) {
  const actionable = row.status === 'PENDING' && row.payoutStatus !== 'PROCESSING';
  if (!actionable) return null;
  return (
    <div className={cn('flex gap-2', stacked && 'grid grid-cols-2')}>
      <Button variant="default" size="sm" onClick={() => onProcess(row)}>
        <Send className="size-3.5" /> {row.payoutStatus === 'FAILED' ? t('requests.retry') : t('requests.process')}
      </Button>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => onReject(row)}>
        <XCircle className="size-3.5" /> {t('requests.reject')}
      </Button>
    </div>
  );
}
