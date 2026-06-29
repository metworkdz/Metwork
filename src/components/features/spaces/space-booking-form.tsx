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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { Badge } from '@/components/ui/badge';
import { Link, useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { walletService } from '@/services/wallet.service';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { safeUUID } from '@/lib/safe-uuid';
import { SpaceScheduler } from './space-scheduler';
import { PromoCodeInput, type PromoResult } from '@/components/shared/promo-code-input';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import { resolveTier } from '@/lib/tier-utils';
import { computeClientDeposit } from '@/lib/deposit';
import type { Locale } from '@/i18n/config';
import type { PaymentMethod, Space } from '@/types/domain';
import type { BookingDto, BookingUnit } from '@/types/booking';

interface SpaceBookingFormProps {
  space: Space;
  onSuccess: (booking: BookingDto, newBalance: number) => void;
  /**
   * Desk / office unit pre-selected upstream (COWORKING desk picker). When set it
   * is sent with the booking so the server blocks that unit, and a small banner
   * confirms the choice. Optional — the regular date-range flow omits it.
   */
  deskName?: string;
  /** Seed the start date (e.g. the day chosen in the desk picker). */
  initialStartDate?: string;
  /** Seed the end date. Defaults to initialStartDate when omitted. */
  initialEndDate?: string;
}

/* ── helpers ── */

function availableUnits(space: Space): { unit: BookingUnit; price: number }[] {
  const out: { unit: BookingUnit; price: number }[] = [];
  if (space.pricePerHour != null) out.push({ unit: 'HOUR', price: space.pricePerHour });
  if (space.pricePerHalfDay != null) out.push({ unit: 'HALF_DAY', price: space.pricePerHalfDay });
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
    case 'HALF_DAY': return 1;
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
  const t = useTranslations('spaces.booking');
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
            {isCash ? t('successTitleCash') : t('bookingConfirmed')}
          </p>
          <p className={cn('mt-1 text-sm', isCash ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200')}>
            {isCash ? t('successMessageCash') : t('successMessageOnline')}
          </p>
          <dl className={cn('mt-3 grid grid-cols-2 gap-2 text-xs', isCash ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100')}>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{t('reference')}</dt>
              <dd className="font-mono">{booking.id.slice(0, 8)}…</dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                {isCash ? t('dueOnSite') : t('totalPaid')}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatCurrency(booking.totalAmount, locale)}
              </dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{t('from')}</dt>
              <dd className="font-medium">{fmtDt(booking.startsAt)}</dd>
            </div>
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{t('to')}</dt>
              <dd className="font-medium">{fmtDt(booking.endsAt)}</dd>
            </div>
            {!isCash && (
              <div>
                <dt className="text-emerald-700 dark:text-emerald-400">{t('newBalance')}</dt>
                <dd className="font-medium tabular-nums">
                  {formatCurrency(newBalance, locale)}
                </dd>
              </div>
            )}
            <div>
              <dt className={isCash ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>{t('status')}</dt>
              <dd className="font-medium">{isCash ? t('awaitingPayment') : t('confirmed')}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/entrepreneur/bookings">{t('viewBookings')}</Link>
            </Button>
            {!isCash && (
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

/* ── Main form ── */

/**
 * Direct-payment choice for the (account-only) space flow:
 *   CARD_FULL  — pay the whole total online by card now (no wallet top-up).
 *   CARD_SPLIT — pay part online by card now, the rest in cash on-site.
 *   WALLET     — pay the whole total from the Metwork wallet balance.
 * The Network Pass is a separate toggle that overrides the choice when active.
 */
type PayChoice = 'CARD_FULL' | 'CARD_SPLIT' | 'WALLET';

export function SpaceBookingForm({
  space,
  onSuccess,
  deskName,
  initialStartDate,
  initialEndDate,
}: SpaceBookingFormProps) {
  const locale   = useLocale() as Locale;
  const t        = useTranslations('spaces.booking');
  const router   = useRouter();
  const { user, refresh } = useAuth();
  const isAuthed = user !== null;

  const units    = useMemo(() => availableUnits(space), [space]);
  const firstUnit = units[0]?.unit ?? 'DAY';

  const [unit,      setUnit]      = useState<BookingUnit>(firstUnit);
  const [startDate, setStartDate] = useState<string>(initialStartDate ?? todayStr());
  const [startTime, setStartTime] = useState<string>(space.openingTime ?? '09:00');
  const [endDate,   setEndDate]   = useState<string>(initialEndDate ?? initialStartDate ?? todayStr());
  const [endTime,   setEndTime]   = useState<string>(() => {
    // Default to a 1-hour window when Hourly is the initial mode, otherwise the
    // full opening–closing span (used by Full day / Monthly).
    const close = space.closingTime ?? '18:00';
    if (firstUnit !== 'HOUR') return close;
    const open = space.openingTime ?? '09:00';
    return minutesToTime(Math.min(parseTime(open) + 60, parseTime(close)));
  });
  const [submitting, setSubmitting] = useState(false);
  // Logged-out "Create account & book" / "Log in" → persist the selection first.
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [error, setError]         = useState<{ code: string; message: string } | null>(null);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  const acceptedMethods = space.acceptedPaymentMethods ?? ['ONLINE'];
  const hasDeposit =
    space.cashDepositType != null && space.cashDepositValue != null;
  const onlineOffered = acceptedMethods.includes('ONLINE');
  const cashOffered = acceptedMethods.includes('CASH');

  // Build the available direct-payment choices from what the listing accepts.
  // ONLINE → card-full + wallet; CASH → 50/50 split (deposit by card, rest cash).
  const payOptions = useMemo<PayChoice[]>(() => {
    const opts: PayChoice[] = [];
    if (onlineOffered) opts.push('CARD_FULL');
    if (cashOffered) opts.push('CARD_SPLIT');
    // The Metwork wallet is account-only — guests pay by card (full or split).
    if (onlineOffered && isAuthed) opts.push('WALLET');
    return opts;
  }, [onlineOffered, cashOffered, isAuthed]);

  const [payChoice, setPayChoice] = useState<PayChoice>(payOptions[0] ?? 'CARD_FULL');
  // Keep the selection valid if the available options change.
  useEffect(() => {
    if (!payOptions.includes(payChoice)) setPayChoice(payOptions[0] ?? 'CARD_FULL');
  }, [payOptions, payChoice]);

  const [useNetworkPass, setUseNetworkPass] = useState(false);

  const isCardFull = !useNetworkPass && payChoice === 'CARD_FULL';
  const isSplit    = !useNetworkPass && payChoice === 'CARD_SPLIT';
  const isWallet   = !useNetworkPass && payChoice === 'WALLET';

  // Stable idempotency key for the booking itself — reused across retries so a
  // dropped response / network retry replays instead of double-booking. It is
  // regenerated whenever the booking parameters change (effect further below).
  const bookingRef = useRef<string>('');
  const ensureBookingRef = useCallback(() => {
    if (!bookingRef.current) bookingRef.current = safeUUID();
    return bookingRef.current;
  }, []);

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

  // Working-hours + booking-mode derived values.
  const workingDaysLabel = (space.workingDays ?? [1, 2, 3, 4, 5]).map((d) => DOW_LABELS[d]).join(', ');
  const openingTime      = space.openingTime ?? '09:00';
  const closingTime      = space.closingTime ?? '18:00';
  const hasDayUnit       = units.some((u) => u.unit === 'DAY');
  // Incubator-configured half-day window (fixed; the customer can't change it).
  const halfDayStart     = space.halfDayStart ?? openingTime;
  const halfDayEnd       = space.halfDayEnd ?? closingTime;

  // Explicit "7 hours or more is billed as a full day" rule. Replaces the old
  // silent HOUR→DAY auto-convert (which made Hourly impossible to keep selected).
  // The UI stays in HOUR mode, but pricing + the SUBMITTED unit become DAY once
  // the window reaches 7h AND the space has a day rate. With no day rate we never
  // invent one — the end-time picker already caps the hourly window at 7h.
  const hourlyMinutes = unit === 'HOUR' && validRange ? parseTime(endTime) - parseTime(startTime) : 0;
  const billedAsDay   = unit === 'HOUR' && hasDayUnit && hourlyMinutes >= MAX_HOURLY_MINUTES;
  const effectiveUnit: BookingUnit = billedAsDay ? 'DAY' : unit;

  // A change to the booking parameters starts a fresh idempotency key, so a
  // resubmit after editing the date/unit/payment method is a NEW booking — not
  // a replay of the previous (now-stale) one.
  useEffect(() => {
    bookingRef.current = '';
  }, [effectiveUnit, startIso, endIso, payChoice, useNetworkPass]);

  const unitPrice = useMemo(
    () => units.find((u) => u.unit === effectiveUnit)?.price ?? 0,
    [effectiveUnit, units],
  );
  const qty   = validRange ? quantity(startIso, endIso, effectiveUnit) : 0;
  const total = unitPrice * qty;
  // Server-side duration discount preview (mirrors bestDurationDiscountPercent).
  // HOUR bookings match HOUR rules; DAY/MONTH match DAY rules. Highest wins.
  const durationPercent = useMemo(() => {
    const rules = space.durationDiscounts ?? [];
    const ruleUnit = effectiveUnit === 'HOUR' || effectiveUnit === 'HALF_DAY' ? 'HOUR' : 'DAY';
    let best = 0;
    for (const r of rules) {
      if (r.unit !== ruleUnit) continue;
      if (r.minQty > 0 && r.percent > 0 && r.percent < 100 && qty >= r.minQty && r.percent > best) best = r.percent;
    }
    return best;
  }, [space.durationDiscounts, effectiveUnit, qty]);
  const durationDiscountAmount = durationPercent > 0 ? total - Math.round(total * (1 - durationPercent / 100)) : 0;
  const afterDuration = total - durationDiscountAmount;
  // Membership-tier space discount (mirrors SPACE_DISCOUNT on the server):
  //   BUILDER  (ENTREPRENEUR membershipCode) → 15 % off
  //   FOUNDER  (STARTUP      membershipCode) → 20 % off
  // Discount is suppressed when the Network Pass is used (already free).
  const membershipDiscountFraction = !isAuthed || useNetworkPass
    ? 0
    : userTier === 'FOUNDER'
    ? 0.20
    : userTier === 'BUILDER'
    ? 0.15
    : 0;
  const membershipDiscountPercent  = Math.round(membershipDiscountFraction * 100);
  const membershipDiscountAmount   = membershipDiscountFraction > 0 ? afterDuration - Math.round(afterDuration * (1 - membershipDiscountFraction)) : 0;
  const afterMembershipDiscount    = afterDuration - membershipDiscountAmount;
  const finalTotal = promoResult?.finalAmount ?? afterMembershipDiscount;
  // Both card paths settle through the hosted checkout — paid directly, with no
  // wallet top-up. Spaces are account-only, so this only runs for signed-in users.
  const useCard = isCardFull || isSplit;

  // Split deposit preview. CARD_SPLIT is only offered when the listing accepts
  // CASH, and a CASH listing ALWAYS has a deposit configured (enforced by
  // validateCashDeposit on every create/edit path), so the split is always the
  // listing's configured deposit. The server recomputes the authoritative split
  // at intent + settlement; computeClientDeposit keeps a null-safety fallback for
  // any malformed legacy record. (The server's fixed-50/50 `splitHalf` fallback
  // stays for direct API callers — this UI never needs it.)
  const splitDepositPreview =
    validRange && finalTotal > 0
      ? computeClientDeposit(finalTotal, space.cashDepositType, space.cashDepositValue) ??
        Math.max(1, Math.round(finalTotal / 2))
      : null;
  const splitBalancePreview =
    splitDepositPreview != null ? Math.max(0, finalTotal - splitDepositPreview) : null;

  const cashDeposit = isSplit ? splitDepositPreview : null;
  const cashBalance = isSplit ? splitBalancePreview : null;
  const insufficient =
    isWallet && isAuthed && balance != null && finalTotal > 0 && balance < finalTotal;

  // Hourly + half-day bookings are single-day — keep end date pinned to start.
  useEffect(() => {
    if ((unit === 'HOUR' || unit === 'HALF_DAY') && endDate !== startDate) setEndDate(startDate);
  }, [unit, startDate, endDate]);

  // Half-day uses the incubator-configured window — keep the times pinned to it.
  useEffect(() => {
    if (unit !== 'HALF_DAY') return;
    if (startTime !== halfDayStart) setStartTime(halfDayStart);
    if (endTime !== halfDayEnd) setEndTime(halfDayEnd);
  }, [unit, halfDayStart, halfDayEnd, startTime, endTime]);

  // Switch booking mode and seed a valid default window for it: Hourly → a
  // 1-hour slot from opening; Full day / Monthly → the full opening–closing span
  // (the scheduler also pins these). Replaces the old silent auto-convert that
  // bounced the user straight back to DAY and made Hourly unselectable.
  const handleModeChange = useCallback(
    (next: BookingUnit) => {
      setUnit(next);
      if (next === 'HOUR') {
        const open = parseTime(openingTime);
        const close = parseTime(closingTime);
        setStartTime(openingTime);
        setEndTime(minutesToTime(Math.min(open + 60, close)));
        setEndDate(startDate);
      } else if (next === 'HALF_DAY') {
        // Fixed window set by the incubator; single day.
        setStartTime(halfDayStart);
        setEndTime(halfDayEnd);
        setEndDate(startDate);
      } else {
        setStartTime(openingTime);
        setEndTime(closingTime);
      }
    },
    [openingTime, closingTime, startDate, halfDayStart, halfDayEnd],
  );

  // Single sink for the scheduler — maps its changes onto the existing booking
  // state. The 7-hour-cap effect above still owns rule enforcement; this just
  // applies whichever fields the scheduler reports.
  const handleScheduleChange = useCallback(
    (next: { startDate?: string; endDate?: string; startTime?: string; endTime?: string }) => {
      if (next.startDate !== undefined) setStartDate(next.startDate);
      if (next.endDate !== undefined) setEndDate(next.endDate);
      if (next.startTime !== undefined) setStartTime(next.startTime);
      if (next.endTime !== undefined) setEndTime(next.endTime);
    },
    [],
  );

  if (units.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        {t('noPricing')}
      </div>
    );
  }

  function mapCardError(err: unknown): { code: string; message: string } {
    if (err instanceof ApiClientError) {
      switch (err.code) {
        case 'OUTSIDE_WORKING_HOURS':
          return {
            code: err.code,
            message: t('errorOutsideHours', {
              open: (err.details as { openingTime?: string })?.openingTime ?? openingTime,
              close: (err.details as { closingTime?: string })?.closingTime ?? closingTime,
            }),
          };
        case 'NOT_A_WORKING_DAY':
          return { code: err.code, message: t('errorNotWorkingDay', { days: workingDaysLabel }) };
        case 'OVERLAP_CONFLICT':
          return { code: err.code, message: t('errorOverlap') };
        case 'UNIT_NOT_AVAILABLE':
          return { code: err.code, message: t('errorUnitNotAvailable') };
        case 'DATE_UNAVAILABLE':
          return { code: err.code, message: t('errorDateUnavailable') };
        case 'ALREADY_BOOKED':
          return { code: err.code, message: t('errorAlreadyBooked') };
        default:
          return { code: err.code, message: err.message || t('errorGeneric') };
      }
    }
    return { code: 'UNKNOWN', message: t('errorGeneric') };
  }

  /**
   * Logged-out flow: persist the current selection as a server-side booking
   * intent, then carry its id to signup or login. After auth, the resume step
   * re-prices + re-checks availability and hands off to the pay page — nothing
   * is re-entered. The price never travels through the client.
   */
  async function handleGuestContinue(dest: 'signup' | 'login') {
    setError(null);
    if (!validRange) {
      setError({ code: 'INVALID_RANGE', message: t('endAfterStart') });
      return;
    }
    setGuestSubmitting(true);
    try {
      const { id } = await bookingService.createSpaceBookingIntent({
        spaceId: space.id,
        unit: effectiveUnit,
        startsAt: startIso,
        endsAt: endIso,
        paymentMode: isSplit ? 'CASH_DEPOSIT' : 'ONLINE_FULL',
      });
      const path = dest === 'signup' ? '/signup' : '/login';
      router.push(`${path}?bookingIntent=${encodeURIComponent(id)}`);
    } catch (err) {
      setError(mapCardError(err));
      setGuestSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validRange) {
      setError({ code: 'INVALID_RANGE', message: t('endAfterStart') });
      return;
    }

    // Space booking is account-only. A guest's primary path is the explicit
    // "Create account & book" / "Log in" CTAs; this guards a stray Enter-key
    // submit by funnelling it through the same selection-preserving flow.
    if (!user) {
      await handleGuestContinue('signup');
      return;
    }

    // A free booking (full promo / Network Pass) never opens a hosted checkout.
    const isFree = useNetworkPass || finalTotal === 0;

    // ── Direct card checkout: full online or 50/50 split (no wallet top-up) ─
    if (!isFree && useCard) {
      const customer = { fullName: user.fullName, email: user.email, phone: user.phone };
      setSubmitting(true);
      try {
        const res = await bookingService.createCardBooking({
          target: { itemKind: 'SPACE', spaceId: space.id, unit: effectiveUnit, startsAt: startIso, endsAt: endIso },
          paymentMode: isSplit ? 'CASH_DEPOSIT' : 'ONLINE_FULL',
          customer,
          clientReference: ensureBookingRef(),
          promoCode: promoResult?.code,
          locale,
        });
        // Leave the SPA for the hosted-checkout pay page.
        window.location.assign(res.payPath);
        return;
      } catch (err) {
        setError(mapCardError(err));
        setSubmitting(false);
      }
      return;
    }

    // ── Wallet balance, Network Pass, or free booking ──────────────────────
    setSubmitting(true);
    try {
      const res = await bookingService.createSpaceBooking({
        spaceId: space.id,
        unit: effectiveUnit,
        startsAt: startIso,
        endsAt:   endIso,
        clientReference: ensureBookingRef(),
        promoCode: promoResult?.code,
        deskName,
        paymentMethod: useNetworkPass
          ? ('NETWORK_PASS' as PaymentMethod)
          : onlineOffered
          ? 'ONLINE'
          : 'CASH',
      });
      setBalance(res.wallet.balance);
      // Booking landed — start a fresh key so a later booking on this form isn't
      // treated as a replay of this one.
      bookingRef.current = '';
      void refresh();
      onSuccess(res.booking, res.wallet.balance);
    } catch (err) {
      if (err instanceof ApiClientError) {
        switch (err.code) {
          case 'OUTSIDE_WORKING_HOURS':
            setError({
              code: err.code,
              message: t('errorOutsideHours', {
                open: (err.details as { openingTime?: string })?.openingTime ?? openingTime,
                close: (err.details as { closingTime?: string })?.closingTime ?? closingTime,
              }),
            });
            break;
          case 'NOT_A_WORKING_DAY':
            setError({ code: err.code, message: t('errorNotWorkingDay', { days: workingDaysLabel }) });
            break;
          case 'OVERLAP_CONFLICT':
            setError({ code: err.code, message: t('errorOverlap') });
            break;
          case 'INSUFFICIENT_FUNDS': {
            const detailBalance = typeof (err.details as { balance?: number })?.balance === 'number'
              ? (err.details as { balance: number }).balance
              : null;
            if (detailBalance != null) setBalance(detailBalance);
            setError({ code: err.code, message: t('errorInsufficientFunds') });
            break;
          }
          case 'WALLET_FROZEN':
            setError({ code: err.code, message: t('errorWalletFrozen') });
            break;
          case 'UNIT_NOT_AVAILABLE':
            setError({ code: err.code, message: t('errorUnitNotAvailable') });
            break;
          default:
            setError({ code: err.code, message: err.message || t('errorGeneric') });
        }
      } else {
        setError({ code: 'UNKNOWN', message: t('errorGeneric') });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>

      {/* Pre-selected desk / office (COWORKING desk picker hand-off) */}
      {deskName && (
        <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
          <CheckCircle2 className="size-3.5 shrink-0" />
          <span>{t('selectedDesk', { desk: deskName })}</span>
        </div>
      )}

      {/* Working hours hint */}
      <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Clock className="size-3.5 shrink-0" />
        <span>{t('open')} {workingDaysLabel} · {openingTime} – {closingTime}</span>
      </div>

      {/* Booking type — Hourly / Full day / Monthly (mode toggle) */}
      {units.length > 1 && (
        <div>
          <span className="text-sm font-medium">{t('bookingType')}</span>
          <div className={cn('mt-1.5 grid gap-2', units.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {units.map((u) => {
              const Icon = u.unit === 'HOUR' || u.unit === 'HALF_DAY' ? Clock : CalendarDays;
              const label =
                u.unit === 'HOUR' ? t('modeHourly')
                : u.unit === 'HALF_DAY' ? t('modeHalfDay')
                : u.unit === 'DAY' ? t('modeFullDay')
                : t('modeMonthly');
              const active = unit === u.unit;
              return (
                <button
                  key={u.unit}
                  type="button"
                  onClick={() => handleModeChange(u.unit)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border px-3 py-2.5 text-center text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/5 font-medium text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{label}</span>
                  <span className="text-xs tabular-nums opacity-80">
                    {formatCurrency(u.price, locale)}/
                    {u.unit === 'HOUR' ? t('hourShort') : u.unit === 'HALF_DAY' ? t('halfDayShort') : u.unit === 'DAY' ? t('dayShort') : t('monthShort')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Mode hint */}
      {unit === 'HOUR' && (
        <div className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Clock className="size-3.5 shrink-0" />
          <span>{hasDayUnit ? t('hourlyBilledAsDay') : t('hourlyCapNotice')}</span>
        </div>
      )}
      {unit === 'DAY' && (
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" />
          <span>{t('fullDayHint', { open: openingTime, close: closingTime })}</span>
        </div>
      )}
      {unit === 'HALF_DAY' && (
        <div className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Clock className="size-3.5 shrink-0" />
          <span>{t('halfDayHint', { start: halfDayStart, end: halfDayEnd })}</span>
        </div>
      )}

      {/* Date + time selection — Airbnb-style calendar (replaces raw inputs) */}
      <SpaceScheduler
        spaceId={space.id}
        openingTime={openingTime}
        closingTime={closingTime}
        unit={unit}
        startDate={startDate}
        endDate={endDate}
        startTime={startTime}
        endTime={endTime}
        onChange={handleScheduleChange}
        locale={locale}
      />

      {/* Selected window summary */}
      {validRange && (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground">
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">
            {unit === 'HOUR' || unit === 'HALF_DAY'
              ? `${formatDate(startIso, locale, { dateStyle: 'medium' })} · ${startTime}–${endTime}`
              : `${formatDate(startIso, locale, { dateStyle: 'medium' })} → ${formatDate(endIso, locale, { dateStyle: 'medium' })}`}
          </span>
        </div>
      )}

      {/* Payment choice — direct card (full), 50/50 split, or wallet */}
      {payOptions.length > 1 && !useNetworkPass && (
        <div>
          <span className="text-sm font-medium">{t('payHeading')}</span>
          <div
            className={cn(
              'mt-1.5 grid gap-2',
              payOptions.length >= 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2',
            )}
          >
            {payOptions.map((opt) => {
              const active = payChoice === opt;
              const Icon = opt === 'CARD_FULL' ? CreditCard : opt === 'CARD_SPLIT' ? Banknote : WalletIcon;
              const title =
                opt === 'CARD_FULL'
                  ? t('methodCardFullTitle')
                  : opt === 'CARD_SPLIT'
                  ? hasDeposit
                    ? t('methodDepositTitle')
                    : t('methodSplitTitle')
                  : t('methodWalletTitle');
              const sub =
                opt === 'CARD_FULL'
                  ? validRange && finalTotal > 0
                    ? t('methodCardFullSub', { amount: formatCurrency(finalTotal, locale) })
                    : null
                  : opt === 'CARD_SPLIT'
                  ? splitDepositPreview != null && splitBalancePreview != null
                    ? t('methodSplitSub', {
                        now: formatCurrency(splitDepositPreview, locale),
                        site: formatCurrency(splitBalancePreview, locale),
                      })
                    : null
                  : balance != null
                  ? t('methodWalletSub', { amount: formatCurrency(balance, locale) })
                  : null;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setPayChoice(opt)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-start text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{title}</span>
                    {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
                  </span>
                </button>
              );
            })}
          </div>
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
                  {t('networkPass')}
                </span>
                <MembershipTierBadge tier={userTier} size="xs" showIcon={false} />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {passCredits > 0 ? (
                  <>
                    {t('passCreditsInfo', { count: passCredits, max: passCreditsMax })}
                    {passResetDate && ` · ${t('passResetsDate', { date: passResetDate })}`}
                  </>
                ) : (
                  <span className="text-destructive">{t('networkPassNoCredits')}</span>
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
              {t('networkPassWarning')}
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
              {effectiveUnit === 'HOUR' ? (qty === 1 ? t('hourShort') : t('hours')) : effectiveUnit === 'HALF_DAY' ? t('halfDayShort') : effectiveUnit === 'DAY' ? (qty === 1 ? t('dayShort') : t('days')) : (qty === 1 ? t('monthShort') : t('months'))}
            </span>
            <span className="tabular-nums">{formatCurrency(total, locale)}</span>
          </div>
          {billedAsDay && (
            <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">{t('hourlyBilledAsDay')}</p>
          )}
          {durationDiscountAmount > 0 && (
            <div className="mt-1 flex items-center justify-between text-emerald-700 dark:text-emerald-400">
              <span>{t('durationDiscount', { percent: durationPercent })}</span>
              <span className="tabular-nums">−{formatCurrency(durationDiscountAmount, locale)}</span>
            </div>
          )}
          {membershipDiscountAmount > 0 && (
            <div className="mt-1 flex items-center justify-between text-emerald-700 dark:text-emerald-400">
              <span className="flex items-center gap-1.5">
                <MembershipTierBadge tier={userTier} size="xs" showIcon={false} />
                {userTier === 'FOUNDER'
                  ? t('founderDiscount', { percent: membershipDiscountPercent })
                  : t('builderDiscount', { percent: membershipDiscountPercent })}
              </span>
              <span className="tabular-nums">−{formatCurrency(membershipDiscountAmount, locale)}</span>
            </div>
          )}
          {promoResult && (
            <div className="mt-1 flex items-center justify-between text-emerald-700">
              <span>
                {t('promoLabel')} ({promoResult.discountType === 'PERCENTAGE'
                  ? `${promoResult.discountValue}% off`
                  : `−${promoResult.discountAmount.toLocaleString()} DZD`})
              </span>
              <span className="tabular-nums">−{formatCurrency(promoResult.discountAmount, locale)}</span>
            </div>
          )}
          {useNetworkPass && (
            <div className="mt-1 flex items-center justify-between text-emerald-700 dark:text-emerald-400">
              <span>{t('networkPassTotal')}</span>
              <span className="tabular-nums">{t('totalFree')}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>{t('total')}</span>
            <span className="tabular-nums">
              {useNetworkPass ? t('totalFree') : formatCurrency(finalTotal, locale)}
            </span>
          </div>
          {cashDeposit != null && cashBalance != null && (
            <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
              <div className="flex items-center justify-between font-medium text-foreground">
                <span>{t('depositDueNow')}</span>
                <span className="tabular-nums">{formatCurrency(cashDeposit, locale)}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t('balanceOnSite')}</span>
                <span className="tabular-nums">{formatCurrency(cashBalance, locale)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {!validRange && startDate && endDate && (
        <p className="text-xs text-destructive">{t('endAfterStart')}</p>
      )}

      {/* Promo code — shown for authenticated users when range is valid and not using network pass */}
      {isAuthed && validRange && total > 0 && !useNetworkPass && (
        <PromoCodeInput
          key={afterMembershipDiscount}
          originalAmount={afterMembershipDiscount}
          onApplied={setPromoResult}
          disabled={submitting}
        />
      )}

      {/* Wallet balance */}
      {isAuthed && isWallet && balance != null && (
        <div className={cn(
          'flex items-center justify-between rounded-md border px-3 py-2 text-xs',
          insufficient
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-border bg-background text-muted-foreground',
        )}>
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
        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            loading={guestSubmitting}
            disabled={!validRange}
            onClick={() => void handleGuestContinue('signup')}
          >
            {guestSubmitting ? t('submitting') : t('createAndBook')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            disabled={guestSubmitting || !validRange}
            onClick={() => void handleGuestContinue('login')}
          >
            {t('haveAccountLogin')}
          </Button>
        </div>
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
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={!validRange}
        >
          {submitting
            ? t('submitting')
            : useNetworkPass || finalTotal === 0
            ? t('submitFree')
            : isCardFull
            ? t('payNow', { amount: formatCurrency(finalTotal, locale) })
            : isSplit
            ? t('payDeposit', { amount: formatCurrency(splitDepositPreview ?? finalTotal, locale) })
            : t('submitOnline', { amount: formatCurrency(finalTotal, locale) })}
        </Button>
      )}
    </form>
  );
}
