'use client';

/**
 * Withdrawal request form.
 * Deducts the amount from the wallet immediately (funds held in escrow).
 * Admin reviews and approves or rejects the request.
 */
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { cn } from '@/lib/utils';
import type { WithdrawalStatus } from '@/server/db/store';

interface WithdrawalRequest {
  id: string;
  amount: number;
  accountDetails: string;
  status: WithdrawalStatus;
  adminNote?: string;
  createdAt: string;
}

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

export function WithdrawalForm() {
  const [requests, setRequests]     = useState<WithdrawalRequest[] | null>(null);
  const [loadErr, setLoadErr]       = useState<string | null>(null);
  const [loaded, setLoaded]         = useState(false);
  const [showForm, setShowForm]     = useState(false);

  // Form fields
  const [amount, setAmount]           = useState('');
  const [accountDetails, setAccountDetails] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [feedback, setFeedback]       = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function loadRequests() {
    setLoadErr(null);
    try {
      const res = await fetch('/api/withdrawals', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load withdrawal history');
      const data = await res.json() as { items: WithdrawalRequest[] };
      setRequests(data.items);
      setLoaded(true);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : 'Load failed');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 500) {
      setFeedback({ kind: 'error', text: 'Enter a whole amount of at least 500 DZD.' });
      return;
    }
    if (accountDetails.trim().length < 5) {
      setFeedback({ kind: 'error', text: 'Please enter your payment account details.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parsed, accountDetails: accountDetails.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
        if (d.error?.code === 'INSUFFICIENT_FUNDS') {
          throw new Error('Insufficient wallet balance.');
        }
        if (d.error?.code === 'WALLET_FROZEN') {
          throw new Error('Your wallet is frozen. Contact support.');
        }
        throw new Error(d.error?.message ?? 'Request failed');
      }
      const data = await res.json() as { withdrawalRequest: WithdrawalRequest };
      setFeedback({ kind: 'success', text: `Withdrawal request of ${formatAmount(parsed)} submitted. Pending admin review.` });
      setAmount('');
      setAccountDetails('');
      setShowForm(false);
      if (requests) {
        setRequests([data.withdrawalRequest, ...requests]);
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Withdraw Funds</CardTitle>
        <div className="flex items-center gap-2">
          {!loaded && (
            <Button type="button" variant="ghost" size="sm" onClick={loadRequests}>
              View history
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => { setShowForm((v) => !v); setFeedback(null); }}
          >
            <ArrowUpRight className="size-4" />
            {showForm ? 'Cancel' : 'Request withdrawal'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'rounded-md border px-3 py-2 text-xs',
              feedback.kind === 'error'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {feedback.text}
          </div>
        )}

        {showForm && (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="wd-amount" className="text-xs font-medium text-muted-foreground">
                Amount (DZD) — minimum 500
              </label>
              <Input
                id="wd-amount"
                type="number"
                min={500}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5000"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="wd-account" className="text-xs font-medium text-muted-foreground">
                Payment account details
              </label>
              <Textarea
                id="wd-account"
                rows={3}
                value={accountDetails}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAccountDetails(e.target.value)}
                placeholder="e.g. CCP: 1234567 clé 89&#10;BaridiMob RIP: 00799999000123456789&#10;Bank: CPA, Oran branch, account 12345"
                className="mt-1 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The amount will be deducted from your wallet immediately and held until admin processes the transfer.
              </p>
            </div>
            <Button type="submit" className="w-full" loading={submitting}>
              Submit withdrawal request
            </Button>
          </form>
        )}

        {loadErr && (
          <p className="text-xs text-destructive">{loadErr}</p>
        )}

        {loaded && (
          <>
            {(requests?.length ?? 0) === 0 ? (
              <InlineEmptyState
                title="No withdrawal requests"
                description="Your past withdrawal requests will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests!.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium tabular-nums">{formatAmount(r.amount)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(r.status)}>{r.status.toLowerCase()}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(r.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[20ch] truncate">
                          {r.adminNote ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
