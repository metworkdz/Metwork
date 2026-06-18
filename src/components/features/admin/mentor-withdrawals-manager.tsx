'use client';

/**
 * Admin panel: list consultant (mentor) withdrawal requests and approve/reject
 * them. Talks to /api/admin/mentor-withdrawals (the parallel mentor ledger).
 * Mirrors WithdrawalsManager but keyed by consultant.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, XCircle, RefreshCw, Banknote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { cn } from '@/lib/utils';
import type { WithdrawalStatus } from '@/server/db/store';

interface MentorWithdrawalRow {
  id: string;
  mentorId: string;
  mentorName: string;
  mentorEmail: string;
  amount: number;
  accountDetails: string;
  status: WithdrawalStatus;
  availableBalance: number;
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

type ActionKind = 'APPROVED' | 'REJECTED';

function statusVariant(status: WithdrawalStatus) {
  switch (status) {
    case 'PENDING':  return 'warning' as const;
    case 'APPROVED': return 'success' as const;
    case 'REJECTED': return 'danger' as const;
  }
}

const formatAmount = (n: number) => `${n.toLocaleString()} DZD`;
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function MentorWithdrawalsManager() {
  const t = useTranslations('admin.withdrawals');
  const [rows, setRows] = useState<MentorWithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [acting, setActing] = useState<{ row: MentorWithdrawalRow; kind: ActionKind } | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/mentor-withdrawals', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load consultant withdrawal requests');
      const data = await res.json() as { items: MentorWithdrawalRow[] };
      setRows(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  function openAction(row: MentorWithdrawalRow, kind: ActionKind) {
    setActing({ row, kind });
    setAdminNote('');
    setActionError(null);
  }

  async function submitAction() {
    if (!acting) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/mentor-withdrawals/${acting.row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: acting.kind, adminNote: adminNote || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Action failed');
      }
      setRows((prev) => prev.map((r) => (r.id === acting.row.id ? { ...r, status: acting.kind, adminNote } : r)));
      setActing(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card><CardContent className="h-32 animate-pulse" /></Card>;
  if (error) return <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t('mentorTableTitle')}</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={() => load()} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            <span className="sr-only">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('mentorEmptyDescription')}
              icon={<Banknote className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colConsultant')}</TableHead>
                    <TableHead>{t('colAmount')}</TableHead>
                    <TableHead>{t('colAvailable')}</TableHead>
                    <TableHead>{t('colAccountDetails')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.mentorName}</div>
                        {r.mentorEmail && <div className="text-xs text-muted-foreground">{r.mentorEmail}</div>}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">{formatAmount(r.amount)}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{formatAmount(r.availableBalance)}</TableCell>
                      <TableCell className="max-w-[20ch]">
                        <p className="truncate text-sm text-muted-foreground" title={r.accountDetails}>{r.accountDetails}</p>
                      </TableCell>
                      <TableCell><Badge variant={statusVariant(r.status)}>{r.status.toLowerCase()}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                      <TableCell>
                        {r.status === 'PENDING' && (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="size-8 text-emerald-600 hover:text-emerald-700"
                              title={t('approve')} onClick={() => openAction(r, 'APPROVED')}>
                              <CheckCircle className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive"
                              title={t('reject')} onClick={() => openAction(r, 'REJECTED')}>
                              <XCircle className="size-4" />
                            </Button>
                          </div>
                        )}
                        {r.adminNote && (
                          <p className="text-xs text-muted-foreground max-w-[16ch] truncate" title={r.adminNote}>{r.adminNote}</p>
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

      <Dialog open={acting !== null} onOpenChange={(o) => { if (!o) setActing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{acting?.kind === 'APPROVED' ? t('approveTitle') : t('rejectTitle')}</DialogTitle>
            <DialogDescription>
              {acting && (acting.kind === 'APPROVED'
                ? t('approveDescription', { amount: formatAmount(acting.row.amount) })
                : t('mentorRejectDescription', { amount: formatAmount(acting.row.amount) }))}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('adminNoteLabel')}</label>
            <Textarea className="mt-1 text-sm" rows={3} placeholder={t('adminNotePlaceholder')}
              value={adminNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdminNote(e.target.value)} />
          </div>
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} disabled={busy}>{t('cancel')}</Button>
            <Button variant={acting?.kind === 'APPROVED' ? 'default' : 'destructive'} loading={busy} onClick={submitAction}>
              {acting?.kind === 'APPROVED' ? t('approve') : t('reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
