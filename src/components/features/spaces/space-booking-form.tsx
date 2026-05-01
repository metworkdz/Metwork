'use client';

/**
 * Inline booking form rendered inside the space-detail sheet. Handles:
 *   - unit + quantity + start-date selection
 *   - live total calculation
 *   - logged-out state (CTA → /login?next=/spaces)
 *   - logged-in state with wallet balance + insufficient-funds path
 *   - submission, success, error, idempotency (UUID per attempt)
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { CalendarDays, CheckCircle2, Wallet as WalletIcon } from 'lucide-react';
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
import type { Locale } from '@/i18n/config';
import type { Space } from '@/types/domain';
import type { BookingDto, BookingUnit } from '@/types/booking';

interface SpaceBookingFormProps {
  space: Space;
  /** Called when a booking succeeds, so the parent can switch the sheet to its success state. */
  onSuccess: (booking: BookingDto, newBalance: number) => void;
}

function availableUnits(space: Space): { unit: BookingUnit; price: number }[] {
  const out: { unit: BookingUnit; price: number }[] = [];
  if (space.pricePerHour != null) out.push({ unit: 'HOUR', price: space.pricePerHour });
  if (space.pricePerDay != null) out.push({ unit: 'DAY', price: space.pricePerDay });
  if (space.pricePerMonth != null) out.push({ unit: 'MONTH', price: space.pricePerMonth });
  return out;
}

function todayLocalDateString(): string {
  const d = new Date();
  // input[type=date] expects YYYY-MM-DD in the user's local date.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoStartOfDay(dateStr: string): string {
  // Parse the YYYY-MM-DD as midnight local, return ISO. The server's
  // bookings ledger stores in UTC.
  const d = new Date(`${dateStr}T09:00:00`);
  return d.toISOString();
}

export function SpaceBookingForm({ space, onSuccess }: SpaceBookingFormProps) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { user, refresh } = useAuth();
  const isAuthed = user !== null;

  const units = useMemo(() => availableUnits(space), [space]);
  const firstUnit = units[0]?.unit ?? 'DAY';
  const [unit, setUnit] = useState<BookingUnit>(firstUnit);
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState<string>(todayLocalDateString());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Wallet balance — fetched lazily; only matters when authed.
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    void walletService.getMyWallet().then((w) => {
      if (!cancelled) setBalance(w.balance);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  const dateId = useId();
  const qtyId = useId();

  const unitPrice = useMemo(
    () => units.find((u) => u.unit === unit)?.price ?? 0,
    [unit, units],
  );
  const total = unitPrice * quantity;
  const insufficient = isAuthed && balance != null && balance < total;

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
    if (quantity < 1) {
      setError({ code: 'BAD_QUANTITY', message: 'Quantity must be at least 1.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await bookingService.createSpaceBooking({
        spaceId: space.id,
        unit,
        quantity,
        startsAt: isoStartOfDay(date),
        clientReference: crypto.randomUUID(),
      });
      setBalance(res.wallet.balance);
      // Refresh AuthProvider too — keeps any other consumer in sync.
      void refresh();
      onSuccess(res.booking, res.wallet.balance);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'INSUFFICIENT_FUNDS') {
          const detailBalance =
            typeof err.details?.balance === 'number' ? err.details.balance : null;
          if (detailBalance != null) setBalance(detailBalance);
          setError({
            code: 'INSUFFICIENT_FUNDS',
            message: 'Not enough wallet balance — top up to continue.',
          });
        } else if (err.code === 'WALLET_FROZEN') {
          setError({
            code: 'WALLET_FROZEN',
            message: 'Your wallet is frozen — contact support.',
          });
        } else if (err.code === 'UNIT_NOT_AVAILABLE') {
          setError({
            code: 'UNIT_NOT_AVAILABLE',
            message: 'That billing unit is no longer available for this space.',
          });
        } else {
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
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={dateId}>Start date</Label>
          <div className="relative mt-1.5">
            <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={dateId}
              type="date"
              min={todayLocalDateString()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="ps-9"
              required
            />
          </div>
        </div>
        <div>
          <Label htmlFor="booking-unit">Bill by</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as BookingUnit)}>
            <SelectTrigger id="booking-unit" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u.unit} value={u.unit}>
                  {unitLabel[u.unit]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor={qtyId}>
          {unit === 'HOUR' ? 'Hours' : unit === 'DAY' ? 'Days' : 'Months'}
        </Label>
        <div className="mt-1.5 inline-flex w-full items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            aria-label="Decrease quantity"
            disabled={quantity <= 1}
          >
            −
          </Button>
          <Input
            id={qtyId}
            type="number"
            min={1}
            max={365}
            value={quantity}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setQuantity(Math.max(1, Math.min(365, Math.floor(n))));
            }}
            className="text-center tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setQuantity((q) => Math.min(365, q + 1))}
            aria-label="Increase quantity"
          >
            +
          </Button>
        </div>
      </div>

      {/* Price summary */}
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>
            {formatCurrency(unitPrice, locale)} × {quantity}{' '}
            {unit === 'HOUR' ? 'hr' : unit === 'DAY' ? 'day' : 'mo'}
          </span>
          <span className="tabular-nums">{formatCurrency(total, locale)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(total, locale)}</span>
        </div>
      </div>

      {/* Wallet status / errors */}
      {isAuthed && balance != null && (
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
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error.message}
        </div>
      )}

      {!isAuthed ? (
        <Button asChild className="w-full" size="lg">
          <Link href={`/login?next=${encodeURIComponent('/spaces')}`}>
            Sign in to book
          </Link>
        </Button>
      ) : insufficient ? (
        <div className="space-y-2">
          <Button asChild className="w-full" size="lg" variant="outline">
            <Link href="/dashboard/entrepreneur/wallet">
              Top up to {formatCurrency(total, locale)}
            </Link>
          </Button>
          <Badge variant="warning" className="w-full justify-center py-1">
            Pay from wallet — top up first
          </Badge>
        </div>
      ) : (
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting ? 'Booking…' : `Confirm booking — ${formatCurrency(total, locale)}`}
        </Button>
      )}
    </form>
  );
}

export function BookingSuccessPanel({
  booking,
  newBalance,
}: {
  booking: BookingDto;
  newBalance: number;
}) {
  const locale = useLocale() as Locale;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-emerald-900">Booking confirmed</p>
          <p className="mt-1 text-sm text-emerald-800">
            We&apos;ve charged your wallet and reserved your spot.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-emerald-900">
            <div>
              <dt className="text-emerald-700">Reference</dt>
              <dd className="font-mono">{booking.id.slice(0, 8)}…</dd>
            </div>
            <div>
              <dt className="text-emerald-700">Total paid</dt>
              <dd className="font-medium tabular-nums">
                {formatCurrency(booking.totalAmount, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-emerald-700">New balance</dt>
              <dd className="font-medium tabular-nums">
                {formatCurrency(newBalance, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-emerald-700">Status</dt>
              <dd className="font-medium">Confirmed</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/entrepreneur/bookings">View my bookings</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/entrepreneur/wallet">View wallet</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
