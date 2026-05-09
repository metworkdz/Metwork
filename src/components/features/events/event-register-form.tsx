'use client';

/**
 * Inline register form for events. Mirrors `program-apply-form.tsx`:
 * same wallet/auth/insufficient/already-registered branching, just with
 * "Register" copy and event-specific error codes.
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
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
import type { Event as PlatformEvent, PaymentMethod } from '@/types/domain';
import type { BookingDto, ItemAttendanceStatus } from '@/types/booking';

interface EventRegisterFormProps {
  event: PlatformEvent;
  status: ItemAttendanceStatus | null;
  onSuccess: (booking: BookingDto, newBalance: number) => void;
}

export function EventRegisterForm({ event, status, onSuccess }: EventRegisterFormProps) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { user, refresh } = useAuth();
  const isAuthed = user !== null;
  const isFree = event.price === 0;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  // Payment method
  const acceptedMethods = event.acceptedPaymentMethods ?? ['ONLINE'];
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(acceptedMethods[0] ?? 'ONLINE');
  const isCash = paymentMethod === 'CASH';
  const showMethodPicker = !isFree && acceptedMethods.includes('ONLINE') && acceptedMethods.includes('CASH');

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

  const passed = status?.eventPassed === true;
  const full = status ? status.taken >= status.capacity : false;
  const alreadyRegistered = !!status?.mine;
  const finalTotal = promoResult?.finalAmount ?? event.price;
  const insufficient = !isFree && !isCash && isAuthed && balance != null && finalTotal > 0 && balance < finalTotal;

  if (alreadyRegistered) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">You&apos;re registered</p>
            <p className="mt-1 text-xs text-emerald-800">
              Your ticket is in{' '}
              <Link href="/dashboard/entrepreneur/bookings" className="font-medium underline">
                My bookings
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (passed) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This event has already happened.
      </div>
    );
  }

  if (full) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This event is sold out.
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent('/events')}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await bookingService.registerForEvent(event.id, {
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
          setError({ code: err.code, message: 'Not enough wallet balance — top up to continue.' });
        } else if (err.code === 'ALREADY_REGISTERED') {
          setError({ code: err.code, message: "You're already registered for this event." });
        } else if (err.code === 'CAPACITY_EXCEEDED') {
          setError({ code: err.code, message: 'Event just sold out.' });
        } else if (err.code === 'EVENT_PASSED') {
          setError({ code: err.code, message: 'Event has just ended.' });
        } else {
          setError({ code: err.code, message: err.message || 'Registration failed.' });
        }
      } else {
        setError({ code: 'UNKNOWN', message: 'Registration failed. Try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Payment method picker — only for paid events with both options */}
      {showMethodPicker && (
        <div>
          <span className="text-sm font-medium">Payment method</span>
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
                {m === 'ONLINE' ? 'Online (wallet)' : 'Cash at door'}
              </button>
            ))}
          </div>
          {isCash && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Your ticket is reserved; settle the payment at the door on the event day.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Ticket</span>
          <span className="tabular-nums">
            {isFree ? <span className="font-medium text-emerald-700">Free</span> : formatCurrency(event.price, locale)}
          </span>
        </div>
        {!isFree && promoResult && (
          <div className="mt-1 flex items-center justify-between text-emerald-700">
            <span>
              Promo ({promoResult.discountType === 'PERCENTAGE'
                ? `${promoResult.discountValue}% off`
                : `−${promoResult.discountAmount.toLocaleString()} DZD`})
            </span>
            <span className="tabular-nums">−{formatCurrency(promoResult.discountAmount, locale)}</span>
          </div>
        )}
        {!isFree && (
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(finalTotal, locale)}</span>
          </div>
        )}
      </div>

      {/* Promo code — for all paid events (online and cash) */}
      {!isFree && isAuthed && (
        <PromoCodeInput
          originalAmount={event.price}
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
            Wallet balance
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
          <Link href={`/login?next=${encodeURIComponent('/events')}`}>Sign in to register</Link>
        </Button>
      ) : insufficient ? (
        <div className="space-y-2">
          <Button asChild className="w-full" size="lg" variant="outline">
            <Link href="/dashboard/entrepreneur/wallet">
              Top up to {formatCurrency(finalTotal, locale)}
            </Link>
          </Button>
          <Badge variant="warning" className="w-full justify-center py-1">
            Pay from wallet — top up first
          </Badge>
        </div>
      ) : (
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting
            ? 'Registering…'
            : isFree || finalTotal === 0
            ? 'Register for free'
            : isCash
            ? `Register — pay ${formatCurrency(finalTotal, locale)} at door`
            : `Register — ${formatCurrency(finalTotal, locale)}`}
        </Button>
      )}
    </form>
  );
}

export function EventRegisterSuccess({
  booking,
  newBalance,
  paid,
}: {
  booking: BookingDto;
  newBalance: number;
  paid: boolean;
}) {
  const locale = useLocale() as Locale;
  const isCash = booking.paymentMethod === 'CASH';

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
            {isCash ? 'Ticket reserved — pay at door' : "You're in"}
          </p>
          <p className={cn('mt-1 text-sm', isCash ? 'text-amber-800' : 'text-emerald-800')}>
            {isCash
              ? 'Your spot is confirmed. Please bring the payment on the event day.'
              : "Your ticket is reserved. We'll email a reminder 24 hours before."}
          </p>
          <dl className={cn('mt-3 grid grid-cols-2 gap-2 text-xs', isCash ? 'text-amber-900' : 'text-emerald-900')}>
            <div>
              <dt className={isCash ? 'text-amber-700' : 'text-emerald-700'}>Reference</dt>
              <dd className="font-mono">{booking.id.slice(0, 8)}…</dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700' : 'text-emerald-700'}>
                {isCash ? 'Due at door' : paid ? 'Paid' : 'Ticket'}
              </dt>
              <dd className="font-medium tabular-nums">
                {paid || isCash ? formatCurrency(booking.totalAmount, locale) : 'Free'}
              </dd>
            </div>
            {paid && !isCash && (
              <div>
                <dt className="text-emerald-700">New balance</dt>
                <dd className="font-medium tabular-nums">{formatCurrency(newBalance, locale)}</dd>
              </div>
            )}
            <div>
              <dt className={isCash ? 'text-amber-700' : 'text-emerald-700'}>Status</dt>
              <dd className="font-medium">{isCash ? 'Awaiting payment' : 'Confirmed'}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/entrepreneur/bookings">View my bookings</Link>
            </Button>
            {paid && !isCash && (
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/entrepreneur/wallet">View wallet</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
