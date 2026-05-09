'use client';

/**
 * Admin panel: list all withdrawal requests and approve/reject them.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, RefreshCw, Banknote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { cn } from '@/lib/utils';
import type { WithdrawalStatus } from '@/server/db/store';

interface WithdrawalRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  amount: number;
  accountDetails: string;
  status: WithdrawalStatus;
  adminNote?: string;
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

function formatAmount(n: number) {
  return `${n.toLocaleString()} DZD`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function WithdrawalsManager() {
  const [rows, setRows]           = useState<WithdrawalRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Action dialog state
  const [acting, setActing]       = useState<{ row: WithdrawalRow; kind: ActionKind } | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy]           = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/withdrawals', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load withdrawal requests');
      const data = await res.json() as { items: WithdrawalRow[] };
      setRows(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  function openAction(row: WithdrawalRow, kind: ActionKind) {
    setActing({ row, kind });
    setAdminNote('');
    setActionError(null);
  }

  async function submitAction() {
    if (!acting) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${acting.row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: acting.kind, adminNote: adminNote || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Action failed');
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === acting.row.id ? { ...r, status: acting.kind, adminNote } : r,
        ),
      );
      setActing(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const pending  = rows.filter((r) => r.status === 'PENDING').length;
  const approved = rows.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.amount, 0);

  if (loading) {
    return <Card><CardContent className="h-40 animate-pulse" /></Card>;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending review</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{pending}</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total approved</p>
          <p className="mt-2 text-2xl font-semibold">{formatAmount(approved)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total requests</p>
          <p className="mt-2 text-2xl font-semibold">{rows.length}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All Withdrawal Requests</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={() => load()} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            <span className="sr-only">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title="No withdrawal requests"
              description="Requests from users and incubators will appear here."
              icon={<Banknote className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Account details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.userName}</div>
                        <div className="text-xs text-muted-foreground">{r.userEmail}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.userRole}</Badge>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">{formatAmount(r.amount)}</TableCell>
                      <TableCell className="max-w-[20ch]">
                        <p className="truncate text-sm text-muted-foreground" title={r.accountDetails}>
                          {r.accountDetails}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{r.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        {r.status === 'PENDING' && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-emerald-600 hover:text-emerald-700"
                              title="Approve"
                              onClick={() => openAction(r, 'APPROVED')}
                            >
                              <CheckCircle className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              title="Reject"
                              onClick={() => openAction(r, 'REJECTED')}
                            >
                              <XCircle className="size-4" />
                            </Button>
                          </div>
                        )}
                        {r.adminNote && (
                          <p className="text-xs text-muted-foreground max-w-[16ch] truncate" title={r.adminNote}>
                            {r.adminNote}
                          </p>
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

      {/* Approve / Reject dialog */}
      <Dialog open={acting !== null} onOpenChange={(o) => { if (!o) setActing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {acting?.kind === 'APPROVED' ? 'Approve withdrawal?' : 'Reject withdrawal?'}
            </DialogTitle>
            <DialogDescription>
              {acting && (
                <>
                  {acting.kind === 'APPROVED'
                    ? `Mark ${formatAmount(acting.row.amount)} withdrawal as approved. Confirm you have transferred the funds externally to the account details provided.`
                    : `Reject this withdrawal. The ${formatAmount(acting.row.amount)} will be refunded back to the user's wallet.`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Admin note (optional)
            </label>
            <Textarea
              className="mt-1 text-sm"
              rows={3}
              placeholder="Add a note for the user…"
              value={adminNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdminNote(e.target.value)}
            />
          </div>
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={acting?.kind === 'APPROVED' ? 'default' : 'destructive'}
              loading={busy}
              onClick={submitAction}
            >
              {acting?.kind === 'APPROVED' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
