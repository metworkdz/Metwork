'use client';

/**
 * New Transfer modal — send a SlickPay payout to a payable target. Locked
 * recipient, read-only masked RIB, amount (pre-filled), live fee preview, an
 * explicit confirm step, and the three send outcomes (sent / confirmation URL /
 * failed + retry). Idempotent via a per-session key; the confirm button is
 * disabled in flight. Bottom sheet on mobile, centred on desktop.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, AlertTriangle, ExternalLink, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { safeUUID } from '@/lib/safe-uuid';
import { MODAL_CONTENT_CLASS, formatAmount, type BankAccountMasked, type PayoutTargetType } from './types';

export interface TransferTarget {
  type: PayoutTargetType;
  id: string;
  name: string;
  balance: number;
  bankAccount: BankAccountMasked | null;
}

interface NewTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TransferTarget | null;
  /** Pre-fill the amount (wallet balance for direct, or requested amount). */
  prefillAmount?: number;
  /** When processing an existing request: locks the amount + uses its reserved hold. */
  withdrawalRequestId?: string | null;
  onSent: () => void;
  /** Open the Add-bank-account modal for this target. */
  onNeedBankAccount: (target: TransferTarget) => void;
}

const MIN = 500;
type Step = 'form' | 'confirm' | 'result';
type Outcome = { kind: 'sent' } | { kind: 'processing'; redirectUrl: string | null } | { kind: 'failed'; message: string };

export function NewTransferModal({
  open, onOpenChange, target, prefillAmount, withdrawalRequestId, onSent, onNeedBankAccount,
}: NewTransferModalProps) {
  const t = useTranslations('admin.payments');
  const isProcessing = !!withdrawalRequestId;

  const [step, setStep] = useState<Step>('form');
  const [amount, setAmount] = useState<string>('');
  const [fee, setFee] = useState<number | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [idemKey, setIdemKey] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setAmount(prefillAmount != null ? String(prefillAmount) : '');
    setFee(null);
    setError(null);
    setOutcome(null);
    setIdemKey(`payout-${safeUUID()}`);
  }, [open, prefillAmount]);

  const amt = Number(amount);
  const amountValid = useMemo(() => {
    if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt < MIN) return false;
    if (!isProcessing && target && amt > target.balance) return false;
    return true;
  }, [amt, isProcessing, target]);

  const hasBank = !!target?.bankAccount;

  async function review() {
    if (!target || !amountValid) return;
    setFeeLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payouts/preview-fee', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error?.message ?? 'Could not preview fee');
      setFee(typeof d.fee === 'number' ? d.fee : null);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview fee');
    } finally {
      setFeeLoading(false);
    }
  }

  async function confirmSend() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payouts/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: target.type,
          targetId: target.id,
          amount: amt,
          idempotencyKey: idemKey,
          ...(withdrawalRequestId ? { withdrawalRequestId } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutcome({ kind: 'failed', message: d?.error?.message ?? 'The payout failed.' });
      } else if (d.finalStatus === 'SENT') {
        setOutcome({ kind: 'sent' });
      } else {
        setOutcome({ kind: 'processing', redirectUrl: d.redirectUrl ?? null });
      }
      setStep('result');
      onSent();
    } catch (err) {
      setOutcome({ kind: 'failed', message: err instanceof Error ? err.message : 'The payout failed.' });
      setStep('result');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className={cn('max-w-md', MODAL_CONTENT_CLASS)}>
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>{t('transfer.subtitle', { name: target?.name ?? '' })}</DialogDescription>
        </DialogHeader>

        {/* No bank account on file → cannot send. */}
        {!hasBank ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
              <Landmark className="mt-0.5 size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('transfer.noBank')}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
              <Button variant="default" onClick={() => target && onNeedBankAccount(target)}>{t('transfer.addBank')}</Button>
            </DialogFooter>
          </div>
        ) : step === 'form' ? (
          <>
            <div className="space-y-4">
              <Field label={t('transfer.recipient')}>{target?.name}</Field>
              <Field label={t('transfer.destination')}>
                <span className="font-mono">{target?.bankAccount?.ribMasked}</span>
                <span className="text-muted-foreground"> · {target?.bankAccount?.firstname} {target?.bankAccount?.lastname}</span>
              </Field>
              <div>
                <label className="text-xs text-muted-foreground">{t('transfer.amount')}</label>
                <Input
                  inputMode="numeric"
                  className="mt-1 text-sm tabular-nums"
                  value={amount}
                  readOnly={isProcessing}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                />
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('transfer.min')}</span>
                  {!isProcessing && target && <span>{t('transfer.balance', { amount: formatAmount(target.balance) })}</span>}
                </div>
                {amount !== '' && !amountValid && (
                  <p className="mt-1 text-xs text-destructive">
                    {amt < MIN ? t('transfer.belowMin') : t('transfer.exceedsBalance')}
                  </p>
                )}
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={feeLoading}>{t('cancel')}</Button>
              <Button variant="default" loading={feeLoading} disabled={!amountValid} onClick={review}>{t('transfer.review')}</Button>
            </DialogFooter>
          </>
        ) : step === 'confirm' ? (
          <>
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <Row label={t('transfer.recipient')} value={target?.name ?? ''} />
              <Row label={t('transfer.destination')} value={`${target?.bankAccount?.ribMasked} · ${target?.bankAccount?.firstname} ${target?.bankAccount?.lastname}`} mono />
              <Row label={t('transfer.beneficiaryReceives')} value={formatAmount(amt)} strong />
              <Row label={t('transfer.fee')} value={fee != null ? formatAmount(fee) : t('transfer.feeUnknown')} />
              <p className="pt-1 text-xs text-muted-foreground">{t('transfer.feeNote')}</p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('form')} disabled={busy}>{t('back')}</Button>
              <Button variant="default" loading={busy} onClick={confirmSend}>{t('transfer.confirmSend')}</Button>
            </DialogFooter>
          </>
        ) : (
          <ResultView outcome={outcome} onClose={() => onOpenChange(false)} onRetry={() => setStep('confirm')} t={t} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{children}</p>
    </div>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-end', strong && 'text-base font-semibold', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}

function ResultView({
  outcome, onClose, onRetry, t,
}: {
  outcome: Outcome | null;
  onClose: () => void;
  onRetry: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!outcome) return null;
  if (outcome.kind === 'sent') {
    return (
      <div className="space-y-4 py-2 text-center">
        <CheckCircle2 className="mx-auto size-10 text-primary" />
        <p className="text-sm font-medium">{t('transfer.sentTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('transfer.sentBody')}</p>
        <DialogFooter><Button variant="default" className="w-full sm:w-auto" onClick={onClose}>{t('transfer.done')}</Button></DialogFooter>
      </div>
    );
  }
  if (outcome.kind === 'processing') {
    return (
      <div className="space-y-4 py-2 text-center">
        <CheckCircle2 className="mx-auto size-10 text-amber-500" />
        <p className="text-sm font-medium">{t('transfer.processingTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('transfer.processingBody')}</p>
        {outcome.redirectUrl && (
          <a
            href={outcome.redirectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="size-4" /> {t('transfer.openConfirmation')}
          </a>
        )}
        <DialogFooter><Button variant="default" className="w-full sm:w-auto" onClick={onClose}>{t('transfer.done')}</Button></DialogFooter>
      </div>
    );
  }
  return (
    <div className="space-y-4 py-2 text-center">
      <AlertTriangle className="mx-auto size-10 text-destructive" />
      <p className="text-sm font-medium">{t('transfer.failedTitle')}</p>
      <p className="text-xs text-destructive">{outcome.message}</p>
      <DialogFooter className="sm:justify-center">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="default" onClick={onRetry}>{t('transfer.retry')}</Button>
      </DialogFooter>
    </div>
  );
}
