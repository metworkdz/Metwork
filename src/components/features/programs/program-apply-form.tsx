'use client';

/**
 * Inline apply form rendered inside the program detail sheet.
 *
 * States, in order of precedence:
 *   1. Program is closed (deadline passed) or full → CTA disabled
 *   2. Already applied → success-style chip + receipt link
 *   3. Logged-out → "Sign in to apply" CTA
 *   4. Wallet has insufficient funds for a paid program → "Top up" CTA
 *   5. Otherwise → "Apply — N DZD" / "Apply for free"
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, CreditCard, Wallet as WalletIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link, useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { walletService } from '@/services/wallet.service';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PromoCodeInput, type PromoResult } from '@/components/shared/promo-code-input';
import type { Locale } from '@/i18n/config';
import type { PaymentMethod, Program } from '@/types/domain';
import type { BookingDto, ItemAttendanceStatus } from '@/types/booking';

interface ProgramApplyFormProps {
  program: Program;
  status: ItemAttendanceStatus | null;
  /** Called when apply succeeds; the parent switches the sheet to success. */
  onSuccess: (booking: BookingDto, newBalance: number) => void;
}

export function ProgramApplyForm({ program, status, onSuccess }: ProgramApplyFormProps) {
  const t = useTranslations('programs.apply');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { user, refresh } = useAuth();
  const isAuthed = user !== null;
  const isFree = program.price === 0;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  // Payment method
  const acceptedMethods = program.acceptedPaymentMethods ?? ['ONLINE'];
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(acceptedMethods[0] ?? 'ONLINE');
  const isCash = paymentMethod === 'CASH';
  const showMethodPicker = !isFree && acceptedMethods.includes('ONLINE') && acceptedMethods.includes('CASH');

  // Wallet balance — only matters for paid online programs.
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!isAuthed || isFree) return;
    let cancelled = false;
    void walletService.getMyWallet().then((w) => {
      if (!cancelled) setBalance(w.balance);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthed, isFree]);

  const closed = status?.deadlinePassed === true;
  const full = status ? status.taken >= status.capacity : false;
  const alreadyApplied = !!status?.mine;
  const finalTotal = promoResult?.finalAmount ?? program.price;
  const insufficient = !isFree && !isCash && isAuthed && balance != null && finalTotal > 0 && balance < finalTotal;

  if (alreadyApplied) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              {t('alreadyAppliedTitle')}
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              {t('alreadyAppliedDescription')}{' '}
              <Link href="/dashboard/entrepreneur/bookings" className="font-medium underline">{t('myBookings')}</Link>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        {t('closed')}
      </div>
    );
  }

  if (full) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        {t('full')}
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent('/programs')}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await bookingService.applyToProgram(program.id, {
        clientReference: crypto.randomUUID(),
        promoCode: promoResult?.code,
        paymentMethod,
      });
      setBalance(res.wallet.balance);
      void refresh();
      onSuccess(res.booking, res.wallet.balance);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'INSUFFICIENT_FUNDS') {
          const detailBalance =
            typeof err.details?.balance === 'number' ? err.details.balance : null;
          if (detailBalance != null) setBalance(detailBalance);
          setError({ code: err.code, message: t('errorInsufficientFunds') });
        } else if (err.code === 'ALREADY_APPLIED') {
          setError({ code: err.code, message: t('errorAlreadyApplied') });
        } else if (err.code === 'CAPACITY_EXCEEDED') {
          setError({ code: err.code, message: t('errorCapacityExceeded') });
        } else if (err.code === 'DEADLINE_PASSED') {
          setError({ code: err.code, message: t('errorDeadlinePassed') });
        } else {
          setError({ code: err.code, message: t('errorGeneric') });
        }
      } else {
        setError({ code: 'UNKNOWN', message: t('errorGeneric') });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Payment method picker — only for paid programs with both options */}
      {showMethodPicker && (
        <div>
          <span className="text-sm font-medium">{t('paymentMethod')}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(['ONLINE', 'CASH'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  paymentMethod === m
                    ? 'border-primary bg-primary/5 font-medium text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {m === 'ONLINE' ? (
                  <CreditCard className="size-4 shrink-0" />
                ) : (
                  <Banknote className="size-4 shrink-0" />
                )}
                {m === 'ONLINE' ? t('paymentOnline') : t('paymentCash')}
              </button>
            ))}
          </div>
          {isCash && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('cashHint')}
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>{t('applicationFee')}</span>
          <span className="tabular-nums">
            {isFree ? <span className="font-medium text-emerald-700">{t('free')}</span> : formatCurrency(program.price, locale)}
          </span>
        </div>
        {!isFree && promoResult && (
          <div className="mt-1 flex items-center justify-between text-emerald-700">
            <span>
              {t('promo')} ({promoResult.discountType === 'PERCENTAGE'
                ? `${promoResult.discountValue}% off`
                : `−${promoResult.discountAmount.toLocaleString()} DZD`})
            </span>
            <span className="tabular-nums">−{formatCurrency(promoResult.discountAmount, locale)}</span>
          </div>
        )}
        {!isFree && (
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>{t('total')}</span>
            <span className="tabular-nums">{formatCurrency(finalTotal, locale)}</span>
          </div>
        )}
      </div>

      {/* Promo code — for all paid programs (online and cash) */}
      {!isFree && isAuthed && (
        <PromoCodeInput
          originalAmount={program.price}
          onApplied={setPromoResult}
          disabled={submitting}
        />
      )}

      {!isFree && !isCash && isAuthed && balance != null && (
        <div
          className={cn(
            'flex items-center justify-between rounded-md border px-3 py-2 text-xs',
            insufficient
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-border bg-background text-muted-foreground',
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <WalletIcon className="size-3.5" />
            {t('walletBalance')}
          </span>
          <span className="font-medium tabular-nums">{formatCurrency(balance, locale)}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error.message}
        </div>
      )}

      {!isAuthed ? (
        <Button asChild className="w-full" size="lg">
          <Link href={`/login?next=${encodeURIComponent('/programs')}`}>{t('signIn')}</Link>
        </Button>
      ) : insufficient ? (
        <div className="space-y-2">
          <Button asChild className="w-full" size="lg" variant="outline">
            <Link href="/dashboard/entrepreneur/wallet">
              {t('topUp', { amount: formatCurrency(finalTotal, locale) })}
            </Link>
          </Button>
          <Badge variant="warning" className="w-full justify-center py-1">
            {t('topUpWarning')}
          </Badge>
        </div>
      ) : (
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting
            ? t('submitting')
            : isFree || finalTotal === 0
            ? t('submitFree')
            : isCash
            ? t('submitCash', { amount: formatCurrency(finalTotal, locale) })
            : t('submitOnline', { amount: formatCurrency(finalTotal, locale) })}
        </Button>
      )}
    </form>
  );
}

export function ProgramApplySuccess({
  booking,
  newBalance,
  paid,
}: {
  booking: BookingDto;
  newBalance: number;
  paid: boolean;
}) {
  const t = useTranslations('programs.apply');
  const locale = useLocale() as Locale;
  const isCash = booking.paymentMethod === 'manual';

  return (
    <div className={cn(
      'rounded-lg border p-5',
      isCash ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50',
    )}>
      <div className="flex items-start gap-3">
        {isCash
          ? <Banknote className="size-5 shrink-0 text-amber-600" />
          : <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
        }
        <div className="min-w-0 flex-1">
          <p className={cn('text-base font-semibold', isCash ? 'text-amber-900' : 'text-emerald-900')}>
            {t('successTitle')}
          </p>
          <p className={cn('mt-1 text-sm', isCash ? 'text-amber-800' : 'text-emerald-800')}>
            {isCash ? t('successMessageCash') : t('successMessageOnline')}
          </p>
          <dl className={cn('mt-3 grid grid-cols-2 gap-2 text-xs', isCash ? 'text-amber-900' : 'text-emerald-900')}>
            <div>
              <dt className={isCash ? 'text-amber-700' : 'text-emerald-700'}>{t('reference')}</dt>
              <dd className="font-mono">{booking.id.slice(0, 8)}…</dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700' : 'text-emerald-700'}>
                {isCash ? t('dueOnSite') : paid ? t('paid') : t('applicationFeeLabel')}
              </dt>
              <dd className="font-medium tabular-nums">
                {paid || isCash ? formatCurrency(booking.totalAmount, locale) : t('free')}
              </dd>
            </div>
            {paid && !isCash && (
              <div>
                <dt className="text-emerald-700">{t('newBalance')}</dt>
                <dd className="font-medium tabular-nums">{formatCurrency(newBalance, locale)}</dd>
              </div>
            )}
            <div>
              <dt className={isCash ? 'text-amber-700' : 'text-emerald-700'}>{t('status')}</dt>
              <dd className="font-medium">{isCash ? t('awaitingPayment') : t('confirmed')}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/entrepreneur/bookings">{t('viewBookings')}</Link>
            </Button>
            {paid && !isCash && (
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/entrepreneur/wallet">{t('viewWallet')}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
