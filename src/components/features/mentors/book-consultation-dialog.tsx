'use client';

/**
 * Consultation booking dialog — with date, time, duration, dynamic pricing, and promo code.
 *
 * Pricing model:
 *  - mentor.consultationFee = rate per hour (DZD)
 *  - price = Math.round((durationMinutes / 60) * consultationFee)
 *  - promo codes validated in real-time via /api/promo-codes/validate
 *  - if final amount = 0 after promo, booking proceeds without payment
 *
 * Status is always PENDING until admin approves.
 * Success panel clearly says "pending approval" (not "confirmed").
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Clock, Calendar, Timer, Tag, Check, AlertCircle, DollarSign, Gift, ChevronLeft, ChevronRight, Pencil, UserPlus, ArrowRight, Mail } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useAuth } from '@/components/providers/auth-provider';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { authService } from '@/services/auth.service';
import { ApiClientError } from '@/lib/api-client';
import {
  BookingCreateAccountFields,
  emptyBookingAccount,
  bookingAccountError,
  type BookingAccountDraft,
} from '@/components/features/booking/booking-create-account-fields';
import { MentorScheduler } from './mentor-scheduler';
import type { DaySlot } from '@/types/mentor';
import { resolveTier } from '@/lib/tier-utils';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';
import { safeUUID } from '@/lib/safe-uuid';
import { DURATION_OPTIONS, computePrice, resolveMentorPricing } from '@/lib/consultation-pricing';
import type { Mentor } from '@/types/mentor';

export { DURATION_OPTIONS };

interface BookConsultationDialogProps {
  mentor: Mentor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-seed the date when opened from the profile scheduler (additive). */
  initialDate?: string | null;
  /** Pre-seed the start time ("HH:MM") when opened from the profile scheduler (additive). */
  initialTime?: string | null;
  /**
   * When true, submit through the instant-book, pay-first flow (no admin
   * approval): members pay from wallet (or SlickPay top-up), guests pay online.
   * Off ⇒ the legacy request-then-approve flow.
   */
  instantBookEnabled?: boolean;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';
type PromoState = 'idle' | 'validating' | 'valid' | 'invalid';
type Step = 'schedule' | 'details';

type SchedulerLocale = 'en' | 'fr' | 'ar';
function toSchedulerLocale(loc: string): SchedulerLocale {
  return loc === 'fr' || loc === 'ar' ? loc : 'en';
}

/**
 * Build a full ISO datetime string in the user's local timezone (with offset),
 * e.g. "2026-05-20T14:00:00+01:00". The server uses this for the 24-hour
 * advance check so that picking a time near midnight doesn't flip to the
 * wrong UTC day.
 */
function buildLocalIso(dateStr: string, timeStr: string): string {
  const [y = 1970, mo = 1, d = 1] = dateStr.split('-').map(Number);
  const [h = 0, mi = 0]           = timeStr.split(':').map(Number);
  const local                     = new Date(y, mo - 1, d, h, mi, 0, 0);
  const tzMin                     = -local.getTimezoneOffset(); // minutes east of UTC
  const sign       = tzMin >= 0 ? '+' : '-';
  const abs        = Math.abs(tzMin);
  const off        = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const pad        = (n: number) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}:00${off}`;
}

function formatDZD(amount: number): string {
  return `${amount.toLocaleString('fr-DZ')} DZD`;
}

export function BookConsultationDialog({
  mentor,
  open,
  onOpenChange,
  initialDate = null,
  initialTime = null,
  instantBookEnabled = false,
}: BookConsultationDialogProps) {
  const { user } = useAuth();
  const userTier = user ? resolveTier(user) : 'EXPLORER';
  // Translation scope for the booking dialog. ~46 references downstream
  // assume `t` is in scope — a previous refactor dropped this call and
  // left the entire dialog throwing ReferenceError on every render.
  const t = useTranslations('mentors.bookConsultation');
  const tAcc = useTranslations('booking.createAccount');
  const locale = useLocale();
  const schedulerLocale = toSchedulerLocale(locale);
  const pathname = usePathname();
  const router = useRouter();

  // Anonymous visitors choose between booking as a guest (pay-after-approval)
  // or signing in (wallet / free credits / member discounts). Logged-in users
  // skip the choice entirely and use the existing registered flow.
  const isGuest = !user;
  const [guestChosen, setGuestChosen] = useState(false);
  // "Book & create an account": the guest registers (email OTP) and the request
  // is tied to the new account; after verification they land on the
  // pending-approval page in their dashboard.
  const [createAccount, setCreateAccount] = useState(false);
  const [account, setAccount] = useState<BookingAccountDraft>(emptyBookingAccount);
  // Stable idempotency key for the guest booking — reused across retries so a
  // double-submit can't create two pending requests.
  const clientRef = useRef<string | null>(null);

  const [step,        setStep]        = useState<Step>('schedule');
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [message,     setMessage]     = useState('');
  const [consultDate, setConsultDate] = useState('');
  const [consultTime, setConsultTime] = useState('');
  const [duration,    setDuration]    = useState<number>(60);
  const [hasAvailability, setHasAvailability] = useState<boolean | null>(null);

  // Free-consultation quota (fetched from /api/consultations on open)
  const [freeQuota,         setFreeQuota]         = useState<number>(0);
  const [freeRemaining,     setFreeRemaining]     = useState<number>(0);
  const [useFreeCredit,     setUseFreeCredit]     = useState<boolean>(false);

  // Promo code state
  const [promoCode,   setPromoCode]      = useState('');
  const [promoState,  setPromoState]     = useState<PromoState>('idle');
  const [promoError,  setPromoError]     = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState<number>(0);   // percent
  const [promoFixed,   setPromoFixed]    = useState<number>(0);    // fixed DZD off

  // Form state
  const [formState,   setFormState]   = useState<FormState>('idle');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  // Fetch the user's monthly free-consultation quota when the dialog opens
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    void fetch('/api/consultations', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        const q = Number(data.freeQuota ?? 0);
        const rem = Number(data.freeSessionsRemaining ?? 0);
        setFreeQuota(q);
        setFreeRemaining(rem);
        // Default the checkbox ON when credits are available — entrepreneurs
        // expect their free consultation to be applied automatically.
        if (rem > 0) setUseFreeCredit(true);
      })
      .catch(() => { /* ignore — fallback to paid display */ });
    return () => { cancelled = true; };
  }, [open, user]);

  // Membership-tier consultation discount (BUILDER 15 %, FOUNDER 20 %).
  // Suppressed when the user is applying a free credit (final price is 0).
  const tierDiscountFraction = !user
    ? 0
    : userTier === 'FOUNDER' ? 0.20
    : userTier === 'BUILDER' ? 0.15
    : 0;
  const tierDiscountPercent  = Math.round(tierDiscountFraction * 100);

  // Derived pricing — resolved through the ONE canonical helper (shared with the
  // public profile + the dashboard panel) so the price never renders as a silent
  // "free" when the mentor simply hasn't set a rate yet.
  const { feePerHour, isPriced } = resolveMentorPricing(mentor ?? {});
  const basePrice    = computePrice(feePerHour, duration);
  const applyFreeCredit = useFreeCredit && freeRemaining > 0 && basePrice > 0;
  const tierDiscountAmt = !applyFreeCredit && tierDiscountFraction > 0
    ? basePrice - Math.round(basePrice * (1 - tierDiscountFraction))
    : 0;
  const afterTierDiscount = applyFreeCredit ? 0 : Math.max(0, basePrice - tierDiscountAmt);
  const discountAmt  = promoState === 'valid' && !applyFreeCredit
    ? (promoFixed > 0 ? promoFixed : Math.round(afterTierDiscount * promoDiscount / 100))
    : 0;
  const finalPrice   = applyFreeCredit ? 0 : Math.max(0, afterTierDiscount - discountAmt);
  const isFree       = feePerHour === 0 || finalPrice === 0;

  function reset() {
    setStep('schedule');
    setName(''); setEmail(''); setPhone(''); setMessage('');
    setConsultDate(''); setConsultTime(''); setDuration(60);
    setPromoCode(''); setPromoState('idle'); setPromoError(null);
    setPromoDiscount(0); setPromoFixed(0);
    setUseFreeCredit(false);
    setHasAvailability(null);
    setGuestChosen(false);
    setCreateAccount(false);
    setAccount(emptyBookingAccount);
    clientRef.current = null;
    setFormState('idle'); setErrorMsg(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  // Seed the date/time when the dialog is opened from the profile scheduler.
  // With a pre-chosen slot we jump straight to the details step; otherwise we
  // start on the schedule step so the user picks a time first.
  useEffect(() => {
    if (!open) return;
    if (initialDate) {
      setConsultDate(initialDate);
      setConsultTime(initialTime ?? '');
      setStep('details');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDate, initialTime]);

  /** Real-time promo code validation — calls /api/promo-codes/validate */
  const validatePromo = useCallback(async () => {
    const code = promoCode.trim();
    if (!code) return;
    if (basePrice === 0) {
      setPromoError(t('promoAlreadyFree'));
      setPromoState('invalid');
      return;
    }

    setPromoState('validating');
    setPromoError(null);

    try {
      const res = await fetch('/api/promo-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, originalAmount: basePrice }),
      });
      const data = await res.json() as {
        valid: boolean;
        error?: string;
        discountType?: 'PERCENTAGE' | 'FIXED';
        discountValue?: number;
        discountAmount?: number;
      };

      if (!data.valid) {
        setPromoState('invalid');
        setPromoError(data.error ?? t('promoInvalid'));
        setPromoDiscount(0);
        setPromoFixed(0);
      } else {
        setPromoState('valid');
        setPromoError(null);
        if (data.discountType === 'PERCENTAGE') {
          setPromoDiscount(data.discountValue ?? 0);
          setPromoFixed(0);
        } else {
          setPromoDiscount(0);
          setPromoFixed(data.discountAmount ?? 0);
        }
      }
    } catch {
      setPromoState('invalid');
      setPromoError(t('promoValidateError'));
    }
  }, [promoCode, basePrice]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mentor) return;

    // Client-side 24h guard (only when a date has been provided)
    if (consultDate && consultTime) {
      const scheduled = new Date(`${consultDate}T${consultTime}:00`);
      const minTime   = new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (scheduled < minTime) {
        setErrorMsg(t('errorDateTooSoon'));
        setFormState('error');
        return;
      }
    }

    // Validate the account fields up-front when registering.
    if (createAccount) {
      const accErr = bookingAccountError(account, tAcc);
      if (accErr) {
        setErrorMsg(accErr);
        setFormState('error');
        return;
      }
    }

    setFormState('submitting');
    setErrorMsg(null);

    const scheduledAt = consultDate && consultTime ? buildLocalIso(consultDate, consultTime) : null;

    // ── Instant-book, pay-first path ──────────────────────────────────────
    // One endpoint for members (wallet-first → SlickPay top-up) and guests
    // (SlickPay direct). No admin approval. The create-account sub-flow is not
    // offered here (it's hidden when instant-book is on).
    if (instantBookEnabled) {
      try {
        if (!clientRef.current) clientRef.current = safeUUID();
        const res = await fetch(`/api/mentors/${mentor.id}/instant-book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name, email, phone, message,
            consultationDate: consultDate || null,
            consultationTime: consultDate && consultTime ? consultTime : null,
            scheduledAt,
            durationMinutes: duration,
            promoCode: promoState === 'valid' ? promoCode.trim() : null,
            useFreeCredit: applyFreeCredit,
            locale: locale === 'en' || locale === 'fr' || locale === 'ar' ? locale : undefined,
            clientReference: clientRef.current,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          setErrorMsg(d.error?.message ?? t('errorGeneric'));
          setFormState('error');
          return;
        }
        const data = await res.json() as {
          mode: 'confirmed' | 'awaiting_payment';
          payToken?: string;
          redirectUrl?: string | null;
        };
        if (data.mode === 'awaiting_payment') {
          // Member top-up → provider checkout; guest → hosted pay page.
          if (data.redirectUrl) { window.location.href = data.redirectUrl; return; }
          if (data.payToken) { router.push(`/consultation/pay/${data.payToken}`); return; }
        }
        setFormState('success'); // confirmed (paid from wallet / free credit)
      } catch {
        setErrorMsg(t('errorNetwork'));
        setFormState('error');
      }
      return;
    }

    try {
      let res: Response;
      if (isGuest) {
        // Guest: NO payment now. The server creates a PENDING/UNPAID request and
        // emails a pay link once an admin approves. Reuse one idempotency key.
        if (!clientRef.current) clientRef.current = safeUUID();
        res = await fetch(`/api/mentors/${mentor.id}/guest-book`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone,
            message,
            consultationDate: consultDate || null,
            consultationTime: consultDate && consultTime ? consultTime : null,
            scheduledAt,
            durationMinutes:  consultDate ? duration : null,
            promoCode:        promoCode.trim() ? promoCode.trim() : null,
            locale:           locale === 'en' || locale === 'fr' || locale === 'ar' ? locale : undefined,
            clientReference:  clientRef.current,
          }),
        });
      } else {
        res = await fetch(`/api/mentors/${mentor.id}/book`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name,
            email,
            phone,
            message,
            consultationDate:  consultDate || null,
            consultationTime:  consultDate && consultTime ? consultTime : null,
            // Full ISO with the user's local timezone offset — lets the server
            // run the 24-hour advance check without forcing UTC. Only sent when a
            // concrete time slot was chosen.
            scheduledAt,
            durationMinutes:   consultDate ? duration : null,
            promoCode:         promoState === 'valid' ? promoCode.trim() : null,
            useFreeCredit:     applyFreeCredit,
          }),
        });
      }

      if (res.status === 401) {
        setErrorMsg(t('errorLoginRequired'));
        setFormState('error');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setErrorMsg(data.error?.message ?? t('errorGeneric'));
        setFormState('error');
        return;
      }

      // "Book & create an account": link the just-created guest request to a
      // new pending account, then go to the OTP step. The carry pointer lives
      // server-side; after verification the user lands on their dashboard
      // (request still pending admin approval — pay link emailed once approved).
      if (createAccount && isGuest) {
        const created = (await res.json().catch(() => ({}))) as { id?: string };
        if (!created.id) {
          setErrorMsg(t('errorGeneric'));
          setFormState('error');
          return;
        }
        const signup = await authService.signupPending({
          fullName: name,
          email,
          phone,
          password: account.password,
          confirmPassword: account.confirmPassword,
          city: account.city,
          locale: locale === 'en' || locale === 'fr' || locale === 'ar' ? locale : undefined,
          intent: { kind: 'CONSULTATION', mentorBookingId: created.id },
        });
        const params = new URLSearchParams({
          userId: signup.userId,
          email: signup.maskedEmail,
          phone: signup.maskedPhone,
        });
        router.push(`/verify-otp?${params.toString()}`);
        return;
      }

      setFormState('success');
    } catch (err) {
      if (createAccount && err instanceof ApiClientError) {
        if (err.code === 'EMAIL_EXISTS') { setErrorMsg(tAcc('errorEmailExists')); setFormState('error'); return; }
        if (err.code === 'PHONE_EXISTS') { setErrorMsg(tAcc('errorPhoneExists')); setFormState('error'); return; }
        setErrorMsg(tAcc('errorGeneric')); setFormState('error'); return;
      }
      setErrorMsg(t('errorNetwork'));
      setFormState('error');
    }
  }

  if (!mentor) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        {formState === 'success' ? (
          /* ── Success: pending approval state ── */
          <div className="flex flex-col items-center py-6 text-center">
            <div className={cn(
              'flex size-14 items-center justify-center rounded-full',
              instantBookEnabled ? 'bg-emerald-50 dark:bg-emerald-950'
                : isGuest ? 'bg-sky-50 dark:bg-sky-950' : 'bg-amber-50 dark:bg-amber-950',
            )}>
              {instantBookEnabled
                ? <Check className="size-7 text-emerald-600 dark:text-emerald-400" />
                : isGuest
                ? <Mail className="size-7 text-sky-600 dark:text-sky-400" />
                : <Clock className="size-7 text-amber-600 dark:text-amber-400" />}
            </div>
            <h2 className="mt-4 text-lg font-semibold">
              {instantBookEnabled ? t('instantConfirmedTitle') : isGuest ? t('guestSuccessTitle') : t('successTitle')}
            </h2>
            <Badge variant={instantBookEnabled ? 'success' : isGuest ? 'info' : 'warning'} className="mt-2">
              {instantBookEnabled ? t('instantConfirmedBadge') : isGuest ? t('guestPendingBadge') : t('pendingReview')}
            </Badge>
            <p className="mt-3 text-sm text-muted-foreground max-w-xs">
              {instantBookEnabled
                ? t('instantConfirmedMessage', { mentorName: mentor.fullName })
                : isGuest
                ? t('guestSuccessMessage', { mentorName: mentor.fullName })
                : t('successMessage', { mentorName: mentor.fullName })}
            </p>
            {consultDate && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                <Calendar className="size-3.5 shrink-0" />
                <span>{consultTime ? `${consultDate} · ${consultTime}` : consultDate}</span>
                <span>·</span>
                <Timer className="size-3.5 shrink-0" />
                <span>{DURATION_OPTIONS.find((d) => d.value === duration)?.label}</span>
              </div>
            )}
            {promoState === 'valid' && discountAmt > 0 && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                {t('promoApplied', { amount: formatDZD(discountAmt) })}
              </p>
            )}
            {feePerHour > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {isFree ? t('freeSession') : t('estimatedFee', { fee: formatDZD(finalPrice) })}
              </p>
            )}
            <Button className="mt-6" onClick={() => handleOpenChange(false)}>
              {t('done')}
            </Button>
          </div>
        ) : isGuest && !guestChosen && !instantBookEnabled ? (
          /* ── Anonymous visitor: choose guest vs account ── */
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t('chooseTitle')}</DialogTitle>
              <DialogDescription>{t('chooseSubtitle')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {/* Continue as guest */}
              <button
                type="button"
                onClick={() => { setGuestChosen(true); setCreateAccount(false); setStep('schedule'); }}
                className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-background px-4 py-3.5 text-start transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <Calendar className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t('guestOptionTitle')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('guestOptionDesc')}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground rtl:rotate-180" />
              </button>

              {/* Book & create an account (inline registration → email OTP) */}
              <button
                type="button"
                onClick={() => { setGuestChosen(true); setCreateAccount(true); setStep('schedule'); }}
                className="flex w-full items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3.5 text-start transition-colors hover:border-primary/60 hover:bg-primary/10"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                  <UserPlus className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{tAcc('createButton')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tAcc('panelSubtitle')}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground rtl:rotate-180" />
              </button>

              <p className="text-center text-xs text-muted-foreground">
                <Link
                  href={{ pathname: '/login', query: { next: pathname } }}
                  className="font-medium text-primary hover:underline"
                >
                  {t('accountOptionTitle')}
                </Link>
              </p>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                {mentor.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mentor.imageUrl}
                    alt={mentor.fullName}
                    className="size-12 rounded-full object-cover"
                  />
                )}
                <div>
                  <DialogTitle>{t('dialogTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('dialogWith', { name: mentor.fullName, position: mentor.position })}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {step === 'schedule' ? (
              /* ── Step 1: pick a date, then a time (Airbnb-style) ── */
              <div className="space-y-4">
                <MentorScheduler
                  mentorId={mentor.id}
                  selectedDate={consultDate || null}
                  onSelectDate={(d) => { setConsultDate(d); setConsultTime(''); }}
                  selectedTime={consultTime || null}
                  onSelectTime={(slot: DaySlot) => setConsultTime(slot.start)}
                  locale={schedulerLocale}
                  onAvailabilityResolved={(has) => setHasAvailability(has)}
                />
                {hasAvailability === false && (
                  <p className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    {t('noAvailabilityNote')}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t('cancel')}
                  </Button>
                  {/* Date AND start time are both required before the details/
                      price step — a booking without a time can't be scheduled. */}
                  <Button type="button" disabled={!consultDate || !consultTime} onClick={() => setStep('details')}>
                    {t('continue')}
                    <ChevronRight className="size-4 rtl:rotate-180" />
                  </Button>
                </DialogFooter>
              </div>
            ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {/* Chosen schedule summary + change link */}
              <button
                type="button"
                onClick={() => setStep('schedule')}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-start text-sm transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <Calendar className="size-4 shrink-0 text-primary" />
                <span className="flex-1">
                  {consultDate
                    ? consultTime
                      ? t('scheduledForDateTime', { date: consultDate, time: consultTime })
                      : t('scheduledForDate', { date: consultDate })
                    : t('noTimeSelected')}
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-primary">
                  <Pencil className="size-3" />
                  {consultDate ? t('change') : t('pickATime')}
                </span>
              </button>

              {/* Personal info */}
              <div className="space-y-1.5">
                <Label htmlFor="bc-name">{t('fullNameLabel')}</Label>
                <Input
                  id="bc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('fullNamePlaceholder')}
                  required
                  disabled={formState === 'submitting'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-email">{t('emailLabel')}</Label>
                  <Input
                    id="bc-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    disabled={formState === 'submitting'}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bc-phone">{t('phoneLabel')}</Label>
                  <Input
                    id="bc-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+213 555 00 00 00"
                    required
                    dir="ltr"
                    disabled={formState === 'submitting'}
                  />
                </div>
              </div>

              {/* Message */}
              <div className="space-y-1.5">
                <Label htmlFor="bc-message">{t('messageLabel')}</Label>
                <textarea
                  id="bc-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder={t('messagePlaceholder')}
                  required
                  disabled={formState === 'submitting'}
                  className={cn(
                    'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors',
                    'placeholder:text-muted-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                />
              </div>

              {/* Duration — drives dynamic pricing */}
              <div className="space-y-1.5">
                <Label htmlFor="bc-dur" className="flex items-center gap-1 text-xs">
                  <Timer className="size-3.5" /> {t('durationLabel')}
                </Label>
                <Select
                  value={String(duration)}
                  onValueChange={(v) => {
                    setDuration(Number(v));
                    // Invalidate promo if base price changes
                    if (promoState === 'valid') {
                      setPromoState('idle');
                      setPromoDiscount(0);
                      setPromoFixed(0);
                    }
                  }}
                  disabled={formState === 'submitting'}
                >
                  <SelectTrigger id="bc-dur" className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((opt) => {
                      const price = computePrice(feePerHour, opt.value);
                      return (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          <span className="flex items-center justify-between gap-6">
                            <span>{opt.label}</span>
                            {feePerHour > 0 && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {formatDZD(price)}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Unpriced mentor — say so plainly rather than implying "free". */}
              {mentor && !isPriced && (
                <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
                  {t('pricingNotSet')}
                </div>
              )}

              {/* Free-consultation credit — checkbox to apply this month's quota.
                  Hidden entirely when 0 remaining (avoids confusing disabled state). */}
              {feePerHour > 0 && freeRemaining > 0 && (
                <label
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-3 text-sm cursor-pointer transition-colors',
                    applyFreeCredit
                      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950'
                      : freeRemaining === 0
                      ? 'border-border bg-muted/30 text-muted-foreground cursor-not-allowed'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={applyFreeCredit}
                    onChange={(e) => setUseFreeCredit(e.target.checked)}
                    disabled={freeRemaining === 0 || formState === 'submitting'}
                    className="mt-0.5 size-4 shrink-0 accent-emerald-600"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Gift className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold">Use a free consultation</span>
                      <MembershipTierBadge tier={userTier} size="xs" showIcon={false} />
                    </div>
                    <div className="mt-0.5 text-xs">
                      {freeRemaining > 0
                        ? `${freeRemaining} of ${freeQuota} remaining this month`
                        : `0 of ${freeQuota} remaining — resets next month`}
                    </div>
                  </div>
                </label>
              )}

              {/* Price breakdown — only shown when mentor charges a fee */}
              {feePerHour > 0 && (
                <div className="rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    <DollarSign className="size-3.5" /> {t('estimatedFeeLabel')}
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {DURATION_OPTIONS.find((d) => d.value === duration)?.label} session
                    </span>
                    <span className="tabular-nums font-medium">{formatDZD(basePrice)}</span>
                  </div>
                  {applyFreeCredit && (
                    <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                      <span className="flex items-center gap-1.5">
                        <Gift className="size-3" />
                        Free consultation ({freeRemaining} of {freeQuota} remaining)
                      </span>
                      <span className="tabular-nums">− {formatDZD(basePrice)}</span>
                    </div>
                  )}
                  {!applyFreeCredit && tierDiscountAmt > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                      <span className="flex items-center gap-1.5">
                        <MembershipTierBadge tier={userTier} size="xs" showIcon={false} />
                        {userTier === 'FOUNDER' ? 'Founder' : 'Builder'} discount ({tierDiscountPercent}% off)
                      </span>
                      <span className="tabular-nums">− {formatDZD(tierDiscountAmt)}</span>
                    </div>
                  )}
                  {!applyFreeCredit && promoState === 'valid' && discountAmt > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                      <span>{t('promoCodeDiscount')}</span>
                      <span className="tabular-nums">− {formatDZD(discountAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold border-t border-border/60 pt-1.5 mt-1.5">
                    <span>
                      {finalPrice === 0
                        ? applyFreeCredit
                          ? 'Free (credit applied)'
                          : 'Free (promo applied)'
                        : 'Total'}
                    </span>
                    <span className={cn('tabular-nums', finalPrice === 0 && 'text-emerald-700 dark:text-emerald-400')}>
                      {finalPrice === 0 ? t('free') : formatDZD(finalPrice)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {t('adminConfirmsNote')}
                  </p>
                </div>
              )}

              {/* Promo code — with real-time validation button */}
              <div className="space-y-1.5">
                <Label htmlFor="bc-promo" className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Tag className="size-3.5" /> {t('promoCodeLabel')}{' '}
                  <span className="font-normal">{t('optional')}</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="bc-promo"
                    value={promoCode}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      setPromoCode(v);
                      // Reset validation when input changes
                      if (promoState !== 'idle') {
                        setPromoState('idle');
                        setPromoError(null);
                        setPromoDiscount(0);
                        setPromoFixed(0);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void validatePromo();
                      }
                    }}
                    placeholder="WELCOME50"
                    disabled={formState === 'submitting'}
                    className={cn(
                      'text-sm font-mono flex-1',
                      promoState === 'valid' && 'border-emerald-500',
                      promoState === 'invalid' && 'border-destructive',
                    )}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void validatePromo()}
                    disabled={
                      formState === 'submitting' ||
                      promoState === 'validating' ||
                      !promoCode.trim()
                    }
                    className="shrink-0"
                  >
                    {promoState === 'validating' ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <svg className="size-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        {t('promoChecking')}
                      </span>
                    ) : promoState === 'valid' ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <Check className="size-3" /> {t('promoAppliedLabel')}
                      </span>
                    ) : (
                      <span className="text-xs">{t('promoApplyButton')}</span>
                    )}
                  </Button>
                </div>
                {promoState === 'invalid' && promoError && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="size-3 shrink-0" />
                    {promoError}
                  </div>
                )}
                {promoState === 'valid' && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3 shrink-0" />
                    {promoDiscount > 0
                      ? t('promoDiscountPercent', { percent: promoDiscount })
                      : t('promoDiscountAmount', { amount: formatDZD(promoFixed) })}
                  </div>
                )}
              </div>

              {/* Account fields — when the guest chose "Book & create an account" */}
              {createAccount && (
                <BookingCreateAccountFields
                  value={account}
                  onChange={setAccount}
                  disabled={formState === 'submitting'}
                  idPrefix="consult"
                />
              )}

              {/* Notice: instant pay-first vs legacy pending-review */}
              {instantBookEnabled ? (
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                  <Check className="size-3.5 mt-0.5 shrink-0" />
                  <span>{t('instantPayNote')}</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <Clock className="size-3.5 mt-0.5 shrink-0" />
                  <span>{isGuest ? t('guestReviewNotice') : t('reviewNotice')}</span>
                </div>
              )}

              {errorMsg && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {errorMsg}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('schedule')}
                  disabled={formState === 'submitting'}
                >
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                  {t('back')}
                </Button>
                <Button type="submit" loading={formState === 'submitting'}>
                  <Calendar className="size-4" />
                  {instantBookEnabled
                    ? (feePerHour > 0 && finalPrice > 0
                        ? `${t('instantBookCta')} · ${formatDZD(finalPrice)}`
                        : t('instantConfirmCta'))
                    : createAccount
                    ? tAcc('submit')
                    : feePerHour > 0
                    ? `${t('sendRequest')} · ${finalPrice === 0 ? t('free') : formatDZD(finalPrice)}`
                    : t('sendRequest')}
                </Button>
              </DialogFooter>
            </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
