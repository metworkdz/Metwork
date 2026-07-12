'use client';

/**
 * Full wallet experience — balance, top-up, history. Wired to the real
 * /api/wallet/* endpoints. Used by both entrepreneur and incubator
 * dashboards (the role just changes the page title).
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight, RefreshCw, Wallet as WalletIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { walletService } from '@/services/wallet.service';
import { WithdrawalForm } from './withdrawal-form';
import { ApiClientError } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  Transaction,
  TransactionStatus,
  TransactionType,
  Wallet,
} from '@/types/wallet';
import type { Locale } from '@/i18n/config';

const PRESETS = [1000, 2000, 5000];

export function WalletDashboard() {
  const t = useTranslations('wallet.dashboard');
  const locale = useLocale() as Locale;
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [w, t] = await Promise.all([
        walletService.getMyWallet(),
        walletService.listTransactions({ pageSize: 25 }),
      ]);
      setWallet(w);
      setTransactions(t.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2 animate-pulse">
          <CardContent className="h-40" />
        </Card>
        <Card className="animate-pulse">
          <CardContent className="h-40" />
        </Card>
      </div>
    );
  }

  if (error || !wallet) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          {error ?? t('walletUnavailable')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BalanceCard
          wallet={wallet}
          locale={locale}
          onRefresh={() => refresh()}
          refreshing={refreshing}
        />
        <TopUpCard
          onTopUpComplete={(updated) => {
            if (updated) setWallet(updated);
            void refresh(true);
          }}
        />
      </div>

      <WithdrawalForm onBalanceChange={() => void refresh(true)} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t('recentActivity')}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            <span className="sr-only">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {transactions && transactions.length > 0 ? (
            <TransactionsTable transactions={transactions} locale={locale} />
          ) : (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Balance card ─────────────────────────── */

function BalanceCard({
  wallet,
  locale,
  onRefresh,
  refreshing,
}: {
  wallet: Wallet;
  locale: Locale;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations('wallet.dashboard');
  const isNegative = wallet.balance < 0;
  return (
    <Card className="lg:col-span-2 overflow-hidden border-primary-100 bg-gradient-to-br from-primary-50 via-background to-background">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">
              {t('availableBalance')}
            </p>
            <p className={cn(
              'mt-3 text-4xl font-semibold tracking-tight tabular-nums',
              isNegative && 'text-destructive',
            )}>
              {formatCurrency(wallet.balance, locale)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('walletId')}: <span className="font-mono">{wallet.id.slice(0, 8)}…</span>
            </p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-md bg-primary-100 text-primary-700">
            <WalletIcon className="size-5" />
          </div>
        </div>
        {isNegative && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <p className="font-semibold">{t('negativeBalanceTitle')}</p>
            <p className="mt-0.5">
              {t('negativeBalanceHint', { amount: formatCurrency(Math.abs(wallet.balance), locale) })}
            </p>
          </div>
        )}
        {wallet.status === 'FROZEN' && (
          <Badge variant="warning" className="mt-4">
            {t('frozen')}
          </Badge>
        )}
        <div className="mt-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            {t('refresh')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Top-up card ─────────────────────────── */

function TopUpCard({
  onTopUpComplete,
}: {
  onTopUpComplete: (wallet: Wallet | null) => void;
}) {
  const t = useTranslations('wallet.dashboard');
  const [amount, setAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  function presetClick(value: number) {
    setAmount(String(value));
    setFeedback(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 100) {
      setFeedback({ kind: 'error', text: t('topUpMinError') });
      return;
    }
    setSubmitting(true);
    try {
      const res = await walletService.createPayment({ amount: parsed });
      if (res.status === 'COMPLETED') {
        // Synchronous settlement (mock provider in sync mode).
        setFeedback({ kind: 'success', text: t('topUpSuccess') });
        setAmount('');
        onTopUpComplete(null);
      } else if (res.paymentUrl) {
        // Redirect to SlickPay hosted checkout.
        window.location.href = res.paymentUrl;
      } else {
        setFeedback({ kind: 'success', text: t('topUpPending') });
        onTopUpComplete(null);
      }
    } catch (err) {
      let text = t('topUpFailed');
      if (err instanceof ApiClientError) {
        if (err.code === 'AMOUNT_OUT_OF_RANGE') text = t('topUpAmountOutOfRange');
        else if (err.code === 'WALLET_FROZEN') text = t('walletFrozenError');
        else if (err.code === 'PROVIDER_FAILED') text = t('providerFailed');
        else text = err.message || text;
      }
      setFeedback({ kind: 'error', text });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('topUpTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => presetClick(p)}
                className={cn(
                  'rounded-md border border-input px-2 py-2 text-xs font-medium transition-colors',
                  String(p) === amount
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'hover:bg-accent',
                )}
              >
                {p.toLocaleString()}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="topup-amount" className="text-xs font-medium text-muted-foreground">
              {t('amountLabel')}
            </label>
            <Input
              id="topup-amount"
              type="number"
              min={100}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
              className="mt-1"
            />
          </div>
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
          <Button type="submit" className="w-full" loading={submitting}>
            {t('topUpButton')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Transactions table ─────────────────────────── */

function statusVariant(status: TransactionStatus) {
  switch (status) {
    case 'COMPLETED':
      return 'success' as const;
    case 'PENDING':
      return 'warning' as const;
    case 'FAILED':
    case 'REVERSED':
      return 'danger' as const;
  }
}

function TransactionsTable({
  transactions,
  locale,
}: {
  transactions: Transaction[];
  locale: Locale;
}) {
  const t = useTranslations('wallet.dashboard');

  function typeLabel(type: TransactionType) {
    switch (type) {
      case 'TOP_UP': return t('typeTopUp');
      case 'PAYMENT': return t('typePayment');
      case 'REFUND': return t('typeRefund');
      case 'ADJUSTMENT': return t('typeAdjustment');
      case 'PAYOUT': return t('typePayout');
      case 'COMMISSION': return t('typeCommission');
    }
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colType')}</TableHead>
            <TableHead className="hidden sm:table-cell">{t('colDescription')}</TableHead>
            <TableHead>{t('colStatus')}</TableHead>
            <TableHead className="text-end">{t('colAmount')}</TableHead>
            <TableHead className="hidden sm:table-cell text-end">{t('colBalance')}</TableHead>
            <TableHead>{t('colDate')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((t) => {
            const isCredit = t.amount > 0;
            return (
              <TableRow key={t.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-sm">
                    {isCredit ? (
                      <ArrowDownRight className="size-4 text-emerald-600" />
                    ) : (
                      <ArrowUpRight className="size-4 text-red-600" />
                    )}
                    {typeLabel(t.type)}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell max-w-[20ch] truncate text-sm text-muted-foreground">
                  {t.description}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(t.status)}>{t.status.toLowerCase()}</Badge>
                </TableCell>
                <TableCell
                  className={cn(
                    'text-end font-medium tabular-nums',
                    isCredit ? 'text-emerald-700' : 'text-foreground',
                  )}
                >
                  {isCredit ? '+' : ''}
                  {formatCurrency(t.amount, locale)}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-end tabular-nums text-muted-foreground">
                  {formatCurrency(t.balanceAfter, locale)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDate(t.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
