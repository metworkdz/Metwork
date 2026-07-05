'use client';

/**
 * Withdraw-money flow (incubator / business / entrepreneur wallet).
 *
 * One dialog, three steps:
 *   account  — add/edit the saved payout account (Bank→RIB / CCP→RIP, both
 *              20 digits). Shown FIRST when no account exists yet.
 *   withdraw — amount (capped at the available balance) + method
 *              (bank_transfer / ccp gated by the saved account type;
 *              cheque always available).
 *   done     — confirmation: the balance is held; funds arrive within 3
 *              business days of approval.
 *
 * Server-side truth lives in src/server/withdrawals/service.ts — every check
 * here is UX only. Bottom-sheet on mobile via Tailwind classes (no JS device
 * detection).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Banknote, CheckCircle2, Landmark, Mail, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { cn } from '@/lib/utils';
import { ApiClientError } from '@/lib/api-client';
import { walletService, type WithdrawalRequestDto } from '@/services/wallet.service';
import {
  SHEET_CONTENT_CLASS,
  isValidAccountNumber,
  methodForAccountType,
  accountTypeForMethod,
  type PayoutAccount,
  type WithdrawalMethod,
} from './payout-account';

const MIN_WITHDRAWAL = 500;

function formatAmount(n: number) {
  return `${n.toLocaleString()} DZD`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function statusVariant(status: WithdrawalRequestDto['status']) {
  switch (status) {
    case 'PENDING':  return 'warning' as const;
    case 'APPROVED': return 'success' as const;
    case 'REJECTED': return 'danger' as const;
  }
}

type Step = 'account' | 'withdraw' | 'done';

export function WithdrawalForm({ onBalanceChange }: { onBalanceChange?: () => void } = {}) {
  const t = useTranslations('wallet.withdrawalForm');
  const tAcc = useTranslations('wallet.payoutAccount');

  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [requests, setRequests] = useState<WithdrawalRequestDto[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('withdraw');
  /** Where the account step returns to: the withdraw flow or just close (Edit). */
  const [afterAccountSave, setAfterAccountSave] = useState<'withdraw' | 'close'>('withdraw');

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const [acc, wallet, list] = await Promise.all([
        walletService.getPayoutAccount(),
        walletService.getMyWallet(),
        walletService.listWithdrawals(),
      ]);
      setAccount(acc.payoutAccount);
      setBalance(wallet.balance);
      setRequests(list.items);
    } catch {
      setLoadErr(t('loadFailed'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function openWithdraw() {
    setStep(account ? 'withdraw' : 'account');
    setAfterAccountSave('withdraw');
    setOpen(true);
  }

  function openEditAccount() {
    setStep('account');
    setAfterAccountSave('close');
    setOpen(true);
  }

  async function onClose() {
    setOpen(false);
    if (step === 'done') {
      await load();
      onBalanceChange?.();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <Button type="button" size="sm" onClick={openWithdraw} disabled={balance === null}>
          <ArrowUpRight className="size-4" />
          {t('withdrawMoney')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadErr && <p className="text-xs text-destructive">{loadErr}</p>}

        {/* Saved payout account */}
        <AccountSummary account={account} onEdit={openEditAccount} tAcc={tAcc} />

        {/* History */}
        {requests !== null && (
          requests.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colAmount')}</TableHead>
                    <TableHead>{t('colMethod')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colNote')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium tabular-nums">{formatAmount(r.amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.method ? t(`method.${r.method}`) : t('method.legacy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{t(`status.${r.status}`)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(r.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-[20ch] truncate text-xs text-muted-foreground">
                        {r.adminNote ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!o) void onClose(); }}>
        <DialogContent className={cn('max-w-md', SHEET_CONTENT_CLASS)}>
          {step === 'account' && (
            <PayoutAccountStep
              initial={account}
              onSaved={(saved) => {
                setAccount(saved);
                if (afterAccountSave === 'withdraw') setStep('withdraw');
                else setOpen(false);
              }}
            />
          )}
          {step === 'withdraw' && (
            <WithdrawStep
              account={account}
              balance={balance ?? 0}
              onEditAccount={() => { setAfterAccountSave('withdraw'); setStep('account'); }}
              onDone={() => setStep('done')}
            />
          )}
          {step === 'done' && <DoneStep onClose={() => void onClose()} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ─────────────────────────── Account summary row ─────────────────────────── */

function AccountSummary({
  account, onEdit, tAcc,
}: {
  account: PayoutAccount | null;
  onEdit: () => void;
  tAcc: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
      {account ? (
        <div className="flex min-w-0 items-center gap-3">
          {account.accountType === 'bank'
            ? <Landmark className="size-4 shrink-0 text-muted-foreground" />
            : <Mail className="size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {account.accountType === 'bank' ? tAcc('savedBank') : tAcc('savedCcp')}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {account.holderName}
              {' · '}
              <span dir="ltr" className="tabular-nums">{account.accountNumber}</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Banknote className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{tAcc('none')}</p>
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onEdit}>
        <Pencil className="size-3.5" />
        {account ? tAcc('edit') : tAcc('add')}
      </Button>
    </div>
  );
}

/* ─────────────────────────── Step 1 — payout account ─────────────────────────── */

function PayoutAccountStep({
  initial, onSaved,
}: {
  initial: PayoutAccount | null;
  onSaved: (account: PayoutAccount) => void;
}) {
  const tAcc = useTranslations('wallet.payoutAccount');

  const [type, setType] = useState<PayoutAccount['accountType']>(initial?.accountType ?? 'bank');
  const [holder, setHolder] = useState(initial?.holderName ?? '');
  const [number, setNumber] = useState(initial?.accountNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numberOk = isValidAccountNumber(number);
  const holderOk = holder.trim().length >= 2;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await walletService.savePayoutAccount({
        accountType: type,
        accountNumber: number.replace(/\s+/g, ''),
        holderName: holder.trim(),
      });
      onSaved(res.payoutAccount);
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === 'INVALID_ACCOUNT_NUMBER'
        ? tAcc('numberInvalid')
        : tAcc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{initial ? tAcc('editTitle') : tAcc('addTitle')}</DialogTitle>
        <DialogDescription>{tAcc('subtitle')}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* Account type — segmented control */}
        <div>
          <p className="text-xs font-medium text-muted-foreground">{tAcc('typeLabel')}</p>
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1" role="radiogroup" aria-label={tAcc('typeLabel')}>
            {(['bank', 'ccp'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={type === v}
                onClick={() => setType(v)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition',
                  type === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v === 'bank' ? <Landmark className="size-4" /> : <Mail className="size-4" />}
                {v === 'bank' ? tAcc('typeBank') : tAcc('typeCcp')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="pa-holder" className="text-xs font-medium text-muted-foreground">
            {tAcc('holderLabel')}
          </label>
          <Input
            id="pa-holder"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder={tAcc('holderPlaceholder')}
            className="mt-1"
          />
        </div>

        <div>
          <label htmlFor="pa-number" className="text-xs font-medium text-muted-foreground">
            {type === 'bank' ? tAcc('numberLabelBank') : tAcc('numberLabelCcp')}
          </label>
          <Input
            id="pa-number"
            dir="ltr"
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^\d\s]/g, ''))}
            placeholder="00799999000123456789"
            className="mt-1 tabular-nums"
          />
          {number.length > 0 && !numberOk && (
            <p className="mt-1 text-xs text-destructive">{tAcc('numberInvalid')}</p>
          )}
        </div>

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        <Button type="button" className="w-full" loading={busy} disabled={!numberOk || !holderOk} onClick={save}>
          {tAcc('save')}
        </Button>
      </div>
    </>
  );
}

/* ─────────────────────────── Step 2 — withdraw ─────────────────────────── */

function WithdrawStep({
  account, balance, onEditAccount, onDone,
}: {
  account: PayoutAccount | null;
  balance: number;
  onEditAccount: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('wallet.withdrawalForm');
  const tAcc = useTranslations('wallet.payoutAccount');

  const defaultMethod: WithdrawalMethod = account ? methodForAccountType(account.accountType) : 'cheque';
  const [method, setMethod] = useState<WithdrawalMethod>(defaultMethod);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(amount);
  const amountOk =
    Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= MIN_WITHDRAWAL && parsed <= balance;

  const methods = useMemo(() => (
    (['bank_transfer', 'ccp', 'cheque'] as const).map((m) => {
      const requiredType = accountTypeForMethod(m);
      const enabled = requiredType === null || account?.accountType === requiredType;
      return { m, enabled, requiredType };
    })
  ), [account]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await walletService.requestWithdrawal({ amount: parsed, method });
      onDone();
    } catch (err) {
      if (err instanceof ApiClientError) {
        switch (err.code) {
          case 'INSUFFICIENT_FUNDS': setError(t('errorInsufficientFunds')); break;
          case 'WALLET_FROZEN':      setError(t('errorWalletFrozen')); break;
          case 'NO_PAYOUT_ACCOUNT':  setError(t('errorNoAccount')); break;
          case 'BELOW_MINIMUM':      setError(t('errorMinAmount')); break;
          case 'MIN_BALANCE':        setError(err.message || t('errorRequestFailed')); break;
          case 'RATE_LIMITED':       setError(t('errorRateLimited')); break;
          default:                   setError(t('errorRequestFailed'));
        }
      } else {
        setError(t('errorRequestFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('withdrawMoney')}</DialogTitle>
        <DialogDescription>{t('availableBalance', { amount: formatAmount(balance) })}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <label htmlFor="wd-amount" className="text-xs font-medium text-muted-foreground">
            {t('amountLabel')}
          </label>
          <Input
            id="wd-amount"
            type="number"
            dir="ltr"
            min={MIN_WITHDRAWAL}
            max={balance}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5000"
            className="mt-1 tabular-nums"
          />
          {amount.length > 0 && Number.isFinite(parsed) && parsed > balance && (
            <p className="mt-1 text-xs text-destructive">{t('errorExceedsBalance')}</p>
          )}
        </div>

        {/* Method */}
        <div role="radiogroup" aria-label={t('methodLabel')} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t('methodLabel')}</p>
          {methods.map(({ m, enabled, requiredType }) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              disabled={!enabled}
              onClick={() => setMethod(m)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-start text-sm transition',
                method === m && enabled ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/40',
                !enabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span>{t(`method.${m}`)}</span>
              {!enabled && requiredType && (
                <span className="text-xs text-muted-foreground">
                  {requiredType === 'bank' ? t('methodNeedsBank') : t('methodNeedsCcp')}
                </span>
              )}
              {enabled && method === m && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
            </button>
          ))}
          <button type="button" onClick={onEditAccount} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
            {account ? tAcc('edit') : tAcc('add')}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">{t('deductionNote')}</p>

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        <Button type="button" className="w-full" loading={busy} disabled={!amountOk} onClick={submit}>
          {t('submitButton')}
        </Button>
      </div>
    </>
  );
}

/* ─────────────────────────── Step 3 — confirmation ─────────────────────────── */

function DoneStep({ onClose }: { onClose: () => void }) {
  const t = useTranslations('wallet.withdrawalForm');
  return (
    <>
      <DialogHeader>
        <DialogTitle className="sr-only">{t('doneTitle')}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-10 text-primary" />
        <p className="text-base font-semibold">{t('doneTitle')}</p>
        <p className="max-w-[36ch] text-sm text-muted-foreground">{t('doneBody')}</p>
        <Button type="button" className="mt-2 w-full" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
    </>
  );
}
