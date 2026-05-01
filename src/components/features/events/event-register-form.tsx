'use client';

/**
 * Inline register form for events. Mirrors `program-apply-form.tsx`:
 * same wallet/auth/insufficient/already-registered branching, just with
 * "Register" copy and event-specific error codes.
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { CheckCircle2, Wallet as WalletIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link, useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { walletService } from '@/services/wallet.service';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Event as PlatformEvent } from '@/types/domain';
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
  const insufficient = !isFree && isAuthed && balance != null && balance < event.price;

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
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Ticket</span>
          <span className="tabular-nums">
            {isFree ? <span className="font-medium text-emerald-700">Free</span> : formatCurrency(event.price, locale)}
          </span>
        </div>
        {!isFree && (
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(event.price, locale)}</span>
          </div>
        )}
      </div>

      {!isFree && isAuthed && balance != null && (
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
              Top up to {formatCurrency(event.price, locale)}
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
            : isFree
            ? 'Register for free'
            : `Register — ${formatCurrency(event.price, locale)}`}
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
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-emerald-900">You&apos;re in</p>
          <p className="mt-1 text-sm text-emerald-800">
            Your ticket is reserved. We&apos;ll email a reminder 24 hours before.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-emerald-900">
            <div>
              <dt className="text-emerald-700">Reference</dt>
              <dd className="font-mono">{booking.id.slice(0, 8)}…</dd>
            </div>
            <div>
              <dt className="text-emerald-700">{paid ? 'Paid' : 'Ticket'}</dt>
              <dd className="font-medium tabular-nums">
                {paid ? formatCurrency(booking.totalAmount, locale) : 'Free'}
              </dd>
            </div>
            {paid && (
              <div>
                <dt className="text-emerald-700">New balance</dt>
                <dd className="font-medium tabular-nums">{formatCurrency(newBalance, locale)}</dd>
              </div>
            )}
            <div>
              <dt className="text-emerald-700">Status</dt>
              <dd className="font-medium">Confirmed</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/entrepreneur/bookings">View my bookings</Link>
            </Button>
            {paid && (
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
