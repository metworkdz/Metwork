'use client';

/**
 * Space booking form — redesigned for explicit start/end datetime.
 *
 * The user picks:
 *   - Start date + start time
 *   - End date   + end time
 *   - Unit (HOUR / DAY / MONTH) for pricing model
 *   - Payment method (if both ONLINE and CASH accepted)
 *
 * Working hours are shown as a hint from the space record.
 * Quantity is derived server-side from (endsAt − startsAt) / unit.
 * The price preview is derived client-side the same way.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Ticket,
  Wallet as WalletIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Link, useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { walletService } from '@/services/wallet.service';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { unitLabel } from './space-meta';
import { PromoCodeInput, type PromoResult } from '@/components/shared/promo-code-input';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import { resolveTier } from '@/lib/tier-utils';
import type { Locale } from '@/i18n/config';
import type { PaymentMethod, Space } from '@/types/domain';
import type { BookingDto, BookingUnit } from '@/types/booking';

interface SpaceBookingFormProps {
  space: Space;
  onSuccess: (booking: BookingDto, newBalance: number) => void;
}

/* ── helpers ── */

function availableUnits(space: Space): { unit: BookingUnit; price: number }[] {
  const out: { unit: BookingUnit; price: number }[] = [];
  if (space.pricePerHour != null) out.push({ unit: 'HOUR', price: space.pricePerHour });
  if (space.pricePerDay  != null) out.push({ unit: 'DAY',  price: space.pricePerDay  });
  if (space.pricePerMonth != null) out.push({ unit: 'MONTH', price: space.pricePerMonth });
  return out;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Build an ISO UTC string from a local date ("YYYY-MM-DD") and local time ("HH:MM").
 * We treat the user's input as-is (no timezone conversion) so the server's
 * working-hours validation compares against the same values.
 */
function toIso(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

/** Compute quantity for a given unit from a start/end ISO pair. */
function quantity(startsAt: string, endsAt: string, unit: BookingUnit): number {
  const diffMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  switch (unit) {
    case 'HOUR':  return Math.max(1, Math.ceil(diffMs / 3_600_000));
    case 'DAY':   return Math.max(1, Math.ceil(diffMs / 86_400_000));
    case 'MONTH': {
      const s = new Date(startsAt);
      const e = new Date(endsAt);
      return Math.max(1, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()));
    }
  }
}

/** Short day-name for a 0-based day-of-week index (Mon=1…Sun=0). */
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Part 6: hourly-cap helpers ── */
const MAX_HOURLY_MINUTES = 420; // 7 hours

function parseTime(t: string): number {
  const parts = t.split(':');
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

function minutesToTime(mins: number): string {
  const clamped = Math.max(0, Math.min(mins, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/* ── BookingSuccessPanel (updated to show start/end datetime) ── */
export function BookingSuccessPanel({
  booking,
  newBalance,
}: {
  booking: BookingDto;
  newBalance: number;
}) {
  const locale = useLocale() as Locale;
  const isCash = booking.paymentMethod === 'manual';
  const fmtDt  = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  return (
    <div className={cn(
      'rounded-lg border p-5',
      isCash
        ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
        : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
    )}>
      <div className="flex items-start gap-3">
        {isCash
          ? <Banknote className="size-5 shrink-0 text-amber-600" />
          : <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
        }
        <div className="min-w-0 flex-1">
          <p className={cn('text-base font-semibold', isCash ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100')}>
            {isCash ? 'Spot reserved — pay on-site' : 'Booking confirmed'}
          </p>
          <p className={cn('mt-1 text-sm', isCash ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200')}>
            {isCash
              ? 'Your reservation is confirmed. Please settle the payment directly with the host.'
              : "We've charged your wallet and reserved your spot."}
          </p>
          <dl className={cn('mt-3 grid grid-cols-2 gap-2 text-xs', isCash ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100')}>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>Reference</dt>
              <dd className="font-mono">{booking.id.slice(0, 8)}…</dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                {isCash ? 'Due on-site' : 'Total paid'}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatCurrency(booking.totalAmount, locale)}
              </dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>From</dt>
              <dd className="font-medium">{fmtDt(booking.startsAt)}</dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>To</dt>
              <dd className="font-medium">{fmtDt(booking.endsAt)}</dd>
            </div>
            {!isCash && (
              <div>
                <dt className="text-emerald-700 dark:text-emerald-400">New balance</dt>
                <dd className="font-medium tabular-nums">
                  {formatCurrency(newBalance, locale)}
                </dd>
              </div>
            )}
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>Status</dt>
              <dd className="font-medium">{isCash ? 'Awaiting payment' : 'Confirmed'}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/entrepreneur/bookings">View my bookings</Link>
            </Button>
            {!isCash && (
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

/* ── Main form ── */
export function SpaceBookingForm({ space, onSuccess }: SpaceBookingFormProps) {
  const locale   = useLocale() as Locale;
  const router   = useRouter();
  const { user, refresh } = useAuth();
  const isAuthed = user !== null;

  const units    = useMemo(() => availableUnits(space), [space]);
  const firstUnit = units[0]?.unit ?? 'DAY';

  const [unit,      setUnit]      = useState<BookingUnit>(firstUnit);
  const [startDate, setStartDate] = useState<string>(todayStr());
  const [startTime, setStartTime] = useState<string>(space.openingTime ?? '09:00');
  const [endDate,   setEndDate]   = useState<string>(todayStr());
  const [endTime,   setEndTime]   = useState<string>(space.closingTime ?? '18:00');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<{ code: string; message: string } | null>(null);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  const acceptedMethods = space.acceptedPaymentMethods ?? ['ONLINE'];
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(acceptedMethods[0] ?? 'ONLINE');
  const [useNetworkPass, setUseNetworkPass] = useState(false);
  const isCash         = paymentMethod === 'CASH' && !useNetworkPass;
  const showMethodPicker = acceptedMethods.includes('ONLINE') && acceptedMethods.includes('CASH');

  // Network Pass eligibility
  const userTier = user ? resolveTier(user) : 'EXPLORER';
  const canUsePass = isAuthed && user !== null && userTier !== 'EXPLORER' && (space.isPartnerInNetwork ?? false);
  const passCredits = user?.networkCredits ?? 0;
  const passCreditsMax = user?.networkCreditsMax ?? 0;
  const passResetDate = user?.networkCreditsResetDate
    ? new Date(user.networkCreditsResetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    void walletService.getMyWallet().then((w) => {
      if (!cancelled) setBalance(w.balance);
    });
    return () => { cancelled = true; };
  }, [isAuthed]);

  const startIso = toIso(startDate, startTime);
  const endIso   = toIso(endDate,   endTime);
  const validRange = new Date(endIso) > new Date(startIso);

  const unitPrice  = useMemo(() => units.find((u) => u.unit === unit)?.price ?? 0, [unit, units]);
  const qty        = validRange ? quantity(startIso, endIso, unit) : 0;
  const total      = unitPrice * qty;
  const finalTotal = promoResult?.finalAmount ?? total;
  const insufficient = !isCash && isAuthed && balance != null && finalTotal > 0 && balance < finalTotal;

  const workingDaysLabel = (space.workingDays ?? [1,2,3,4,5]).map((d) => DOW_LABELS[d]).join(', ');
  const openingTime      = space.openingTime ?? '09:00';
  const closingTime      = space.closingTime ?? '18:00';

  // Part 6: 7-hour hourly cap derived values
  const hasDayUnit = units.some((u) => u.unit === 'DAY');
  const maxHourlyEndTime = useMemo(
    () => minutesToTime(Math.min(parseTime(startTime) + MAX_HOURLY_MINUTES, parseTime(closingTime))),
    [startTime, closingTime],
  );

  // Enforce 7-hour cap; auto-switch to DAY billing when exceeded (if available)
  useEffect(() => {
    if (unit !== 'HOUR') return;
    // Hourly bookings must start and end on the same day — snap end date if needed
    if (endDate !== startDate) {
      setEndDate(startDate);
      return;
    }
    const diffMins = parseTime(endTime) - parseTime(startTime);
    if (diffMins > MAX_HOURLY_MINUTES) {
      if (hasDayUnit) {
        setUnit('DAY'); // auto-convert
      } else {
        setEndTime(maxHourlyEndTime); // hard cap
      }
    }
  }, [unit, startDate, endDate, startTime, endTime, maxHourlyEndTime, hasDayUnit]);

  const startDateId = useId();
  const startTimeId = useId();
  const endDateId   = useId();
  const endTimeId   = useId();

  if (units.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        Pricing for this space is by request — please contact the host directly.
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent('/spaces')}`);
      return;
    }
    if (!validRange) {
      setError({ code: 'INVALID_RANGE', message: 'End must be after start.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await bookingService.createSpaceBooking({
        spaceId: space.id,
        unit,
        startsAt: startIso,
        endsAt:   endIso,
        clientReference: crypto.randomUUID(),
        promoCode: promoResult?.code,
        paymentMethod: useNetworkPass ? ('NETWORK_PASS' as PaymentMethod) : paymentMethod,
      });
      setBalance(res.wallet.balance);
      void refresh();
      onSuccess(res.booking, res.wallet.balance);
    } catch (err) {
      if (err instanceof ApiClientError) {
        switch (err.code) {
          case 'OUTSIDE_WORKING_HOURS':
            setError({
              code: err.code,
              message: `Booking must be within working hours: ${
                (err.details as { openingTime?: string })?.openingTime ?? openingTime
              } – ${
                (err.details as { closingTime?: string })?.closingTime ?? closingTime
              }.`,
            });
            break;
          case 'NOT_A_WORKING_DAY':
            setError({ code: err.code, message: `This space is only open on: ${workingDaysLabel}.` });
            break;
          case 'OVERLAP_CONFLICT':
            setError({ code: err.code, message: 'This time slot is already booked. Please choose a different time.' });
            break;
          case 'INSUFFICIENT_FUNDS': {
            const detailBalance = typeof (err.details as { balance?: number })?.balance === 'number'
              ? (err.details as { balance: number }).balance
              : null;
            if (detailBalance != null) setBalance(detailBalance);
            setError({ code: err.code, message: 'Not enough wallet balance — top up to continue.' });
            break;
          }
          case 'WALLET_FROZEN':
            setError({ code: err.code, message: 'Your wallet is frozen — contact support.' });
            break;
          case 'UNIT_NOT_AVAILABLE':
            setError({ code: err.code, message: 'That billing unit is no longer available.' });
            break;
          default:
            setError({ code: err.code, message: err.message || 'Booking failed.' });
        }
      } else {
        setError({ code: 'UNKNOWN', message: 'Booking failed. Try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>

      {/* Working hours hint */}
      <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Clock className="size-3.5 shrink-0" />
        <span>Open {workingDaysLabel} · {openingTime} – {closingTime}</span>
      </div>

      {/* 7-hour cap notice — shown for hourly bookings only */}
      {unit === 'HOUR' && (
        <div className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Clock className="size-3.5 shrink-0" />
          <span>
            Hourly bookings: max 7 hours per day
            {hasDayUnit ? ' — exceeding this will automatically switch to the day rate' : ''}.
          </span>
        </div>
      )}

      {/* Start */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={startDateId}>Start date</Label>
          <div className="relative mt-1.5">
            <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={startDateId}
              type="date"
              min={todayStr()}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              className="ps-9"
              required
            />
          </div>
        </div>
        <div>
          <Label htmlFor={startTimeId}>Start time</Label>
          <div className="relative mt-1.5">
            <Clock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={startTimeId}
              type="time"
              value={startTime}
              min={openingTime}
              max={closingTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="ps-9"
              required
            />
          </div>
        </div>
      </div>

      {/* End */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={endDateId}>End date</Label>
          <div className="relative mt-1.5">
            <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={endDateId}
              type="date"
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="ps-9"
              required
            />
          </div>
        </div>
        <div>
          <Label htmlFor={endTimeId}>End time</Label>
          <div className="relative mt-1.5">
            <Clock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={endTimeId}
              type="time"
              value={endTime}
              min={unit === 'HOUR' && endDate === startDate ? startTime : openingTime}
              max={unit === 'HOUR' && endDate === startDate ? maxHourlyEndTime : closingTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="ps-9"
              required
            />
          </div>
        </div>
      </div>

      {/* Unit (pricing model) */}
      {units.length > 1 && (
        <div>
          <Label htmlFor="booking-unit">Pricing unit</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as BookingUnit)}>
            <SelectTrigger id="booking-unit" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.unit} value={u.unit}>
                  {unitLabel[u.unit]} — {formatCurrency(u.price, locale)}/{u.unit === 'HOUR' ? 'hr' : u.unit === 'DAY' ? 'day' : 'mo'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Payment method picker */}
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
                {m === 'ONLINE'
                  ? <CreditCard className="size-4 shrink-0" />
                  : <Banknote className="size-4 shrink-0" />}
                {m === 'ONLINE' ? 'Online (wallet)' : 'Cash on-site'}
              </button>
            ))}
          </div>
          {isCash && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Your spot is reserved; payment is settled directly with the host.
            </p>
          )}
        </div>
      )}

      {/* ── Network Pass option (Builder / Founder only, partner spaces) ── */}
      {canUsePass && (
        <div>
          <button
            type="button"
            onClick={() => setUseNetworkPass((v) => !v)}
            className={cn(
              'flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
              useNetworkPass
                ? userTier === 'FOUNDER'
                  ? 'border-platinum-300/80 bg-platinum-50 dark:border-platinum-600/50 dark:bg-platinum-900/20'
                  : 'border-gold-600/60 bg-gold-50 dark:border-gold-700/50 dark:bg-gold-900/20'
                : 'border-border text-muted-foreground hover:border-primary/40',
            )}
          >
            <Ticket
              className={cn(
                'mt-0.5 size-4 shrink-0',
                useNetworkPass
                  ? userTier === 'FOUNDER' ? 'text-platinum-600 dark:text-platinum-400' : 'text-gold-600 dark:text-gold-400'
                  : 'text-muted-foreground',
              )}
            />
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className={cn('font-semibold', useNetworkPass ? 'text-foreground' : '')}>
                  Book with Network Pass
                </span>
                <MembershipTierBadge tier={userTier} size="xs" showIcon={false} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {passCredits > 0 ? (
                  <>
                    Uses 1 credit &mdash; {passCredits} of {passCreditsMax} left
                    {passResetDate && ` · Resets ${passResetDate}`}
                  </>
                ) : (
                  <span className="text-destructive">No credits remaining this month</span>
                )}
              </div>
            </div>
            {useNetworkPass && (
              <CheckCircle2
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  userTier === 'FOUNDER' ? 'text-platinum-600' : 'text-gold-600',
                )}
              />
            )}
          </button>
          {useNetworkPass && passCredits === 0 && (
            <p className="mt-1.5 text-xs text-destructive">
              You have no credits left this month. Credits reset on the 1st.
            </p>
          )}
        </div>
      )}

      {/* Price summary */}
      {validRange && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>
              {formatCurrency(unitPrice, locale)} × {qty}{' '}
              {unit === 'HOUR' ? (qty === 1 ? 'hr' : 'hrs') : unit === 'DAY' ? (qty === 1 ? 'day' : 'days') : (qty === 1 ? 'mo' : 'mos')}
            </span>
            <span className="tabular-nums">{formatCurrency(total, locale)}</span>
          </div>
          {promoResult && (
            <div className="mt-1 flex items-center justify-between text-emerald-700">
              <span>
                Promo ({promoResult.discountType === 'PERCENTAGE'
                  ? `${promoResult.discountValue}% off`
                  : `−${promoResult.discountAmount.toLocaleString()} DZD`})
              </span>
              <span className="tabular-nums">−{formatCurrency(promoResult.discountAmount, locale)}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(finalTotal, locale)}</span>
          </div>
        </div>
      )}

      {!validRange && startDate && endDate && (
        <p className="text-xs text-destructive">End must be after start.</p>
      )}

      {/* Promo code — shown for all authenticated users when range is valid */}
      {isAuthed && validRange && total > 0 && (
        <PromoCodeInput
          key={total}
          originalAmount={total}
          onApplied={setPromoResult}
          disabled={submitting}
        />
      )}

      {/* Wallet balance */}
      {isAuthed && !isCash && balance != null && (
        <div className={cn(
          'flex items-center justify-between rounded-md border px-3 py-2 text-xs',
          insufficient
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-border bg-background text-muted-foreground',
        )}>
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
          <Link href={`/login?next=${encodeURIComponent('/spaces')}`}>Sign in to book</Link>
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
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={!validRange}
        >
          {submitting
            ? 'Booking…'
            : isCash
            ? `Reserve spot — pay ${formatCurrency(finalTotal, locale)} on-site`
            : finalTotal === 0
            ? 'Confirm booking — Free'
            : `Confirm booking — ${formatCurrency(finalTotal, locale)}`}
        </Button>
      )}
    </form>
  );
}
