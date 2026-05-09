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
import { useState, useCallback } from 'react';
import { Clock, Calendar, Timer, Tag, Check, AlertCircle, DollarSign } from 'lucide-react';
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
import type { Mentor } from '@/types/mentor';

interface BookConsultationDialogProps {
  mentor: Mentor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';
type PromoState = 'idle' | 'validating' | 'valid' | 'invalid';

export const DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2 h 30' },
  { value: 180, label: '3 hours' },
];

/** Compute price from hourly rate and duration. Returns 0 if fee is free. */
function computePrice(feePerHour: number, durationMinutes: number): number {
  if (!feePerHour || feePerHour <= 0) return 0;
  return Math.round((durationMinutes / 60) * feePerHour);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDZD(amount: number): string {
  return `${amount.toLocaleString('fr-DZ')} DZD`;
}

export function BookConsultationDialog({
  mentor,
  open,
  onOpenChange,
}: BookConsultationDialogProps) {
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [message,     setMessage]     = useState('');
  const [consultDate, setConsultDate] = useState('');
  const [consultTime, setConsultTime] = useState('10:00');
  const [duration,    setDuration]    = useState<number>(60);

  // Promo code state
  const [promoCode,   setPromoCode]      = useState('');
  const [promoState,  setPromoState]     = useState<PromoState>('idle');
  const [promoError,  setPromoError]     = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState<number>(0);   // percent
  const [promoFixed,   setPromoFixed]    = useState<number>(0);    // fixed DZD off

  // Form state
  const [formState,   setFormState]   = useState<FormState>('idle');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  // Derived pricing
  const feePerHour   = mentor?.consultationFee ?? 0;
  const basePrice    = computePrice(feePerHour, duration);
  const discountAmt  = promoState === 'valid'
    ? (promoFixed > 0 ? promoFixed : Math.round(basePrice * promoDiscount / 100))
    : 0;
  const finalPrice   = Math.max(0, basePrice - discountAmt);
  const isFree       = feePerHour === 0 || finalPrice === 0;

  function reset() {
    setName(''); setEmail(''); setPhone(''); setMessage('');
    setConsultDate(''); setConsultTime('10:00'); setDuration(60);
    setPromoCode(''); setPromoState('idle'); setPromoError(null);
    setPromoDiscount(0); setPromoFixed(0);
    setFormState('idle'); setErrorMsg(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  /** Real-time promo code validation — calls /api/promo-codes/validate */
  const validatePromo = useCallback(async () => {
    const code = promoCode.trim();
    if (!code) return;
    if (basePrice === 0) {
      setPromoError('No fee to discount — consultation is already free.');
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
        setPromoError(data.error ?? 'Invalid promo code');
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
      setPromoError('Could not validate code. Check your connection.');
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
        setErrorMsg('Please choose a date and time at least 24 hours from now.');
        setFormState('error');
        return;
      }
    }

    setFormState('submitting');
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/mentors/${mentor.id}/book`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          email,
          phone,
          message,
          consultationDate:  consultDate || null,
          consultationTime:  consultDate ? consultTime : null,
          durationMinutes:   consultDate ? duration : null,
          promoCode:         promoState === 'valid' ? promoCode.trim() : null,
          // Pass the computed amounts so server can verify/store them
          basePrice,
          finalPrice,
        }),
      });

      if (res.status === 401) {
        setErrorMsg('Please log in to book a consultation.');
        setFormState('error');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setErrorMsg(data.error?.message ?? 'Something went wrong. Please try again.');
        setFormState('error');
        return;
      }
      setFormState('success');
    } catch {
      setErrorMsg('Network error. Please check your connection.');
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
            <div className="flex size-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950">
              <Clock className="size-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Request submitted!</h2>
            <Badge variant="warning" className="mt-2">Pending review</Badge>
            <p className="mt-3 text-sm text-muted-foreground max-w-xs">
              Your consultation request with{' '}
              <span className="font-medium text-foreground">{mentor.fullName}</span>{' '}
              has been submitted. You will receive an email once it has been reviewed.
            </p>
            {consultDate && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                <Calendar className="size-3.5 shrink-0" />
                <span>{consultDate} at {consultTime}</span>
                <span>·</span>
                <Timer className="size-3.5 shrink-0" />
                <span>{DURATION_OPTIONS.find((d) => d.value === duration)?.label}</span>
              </div>
            )}
            {promoState === 'valid' && discountAmt > 0 && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                🎉 Promo code applied — {formatDZD(discountAmt)} discount!
              </p>
            )}
            {feePerHour > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {isFree ? 'Free session (promo applied)' : `Estimated fee: ${formatDZD(finalPrice)}`}
              </p>
            )}
            <Button className="mt-6" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
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
                  <DialogTitle>Book a consultation</DialogTitle>
                  <DialogDescription>
                    with {mentor.fullName} · {mentor.position}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <form onSubmit={onSubmit} className="space-y-4">
              {/* Personal info */}
              <div className="space-y-1.5">
                <Label htmlFor="bc-name">Full name</Label>
                <Input
                  id="bc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  disabled={formState === 'submitting'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bc-email">Email</Label>
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
                  <Label htmlFor="bc-phone">Phone</Label>
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
                <Label htmlFor="bc-message">What do you need help with?</Label>
                <textarea
                  id="bc-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Describe your situation and what you're hoping to get from the session…"
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

              {/* Preferred schedule + duration (optional) */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Preferred schedule{' '}
                  <span className="normal-case font-normal text-muted-foreground/70">(optional)</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bc-date" className="flex items-center gap-1 text-xs">
                      <Calendar className="size-3.5" /> Date
                    </Label>
                    <Input
                      id="bc-date"
                      type="date"
                      min={todayStr()}
                      value={consultDate}
                      onChange={(e) => setConsultDate(e.target.value)}
                      disabled={formState === 'submitting'}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bc-time" className="flex items-center gap-1 text-xs">
                      <Clock className="size-3.5" /> Start time
                    </Label>
                    <Input
                      id="bc-time"
                      type="time"
                      value={consultTime}
                      onChange={(e) => setConsultTime(e.target.value)}
                      disabled={formState === 'submitting' || !consultDate}
                      className="text-sm"
                    />
                  </div>
                </div>

                {/* Duration — drives dynamic pricing */}
                <div className="space-y-1.5">
                  <Label htmlFor="bc-dur" className="flex items-center gap-1 text-xs">
                    <Timer className="size-3.5" /> Duration
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
              </div>

              {/* Price breakdown — only shown when mentor charges a fee */}
              {feePerHour > 0 && (
                <div className="rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    <DollarSign className="size-3.5" /> Estimated fee
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {DURATION_OPTIONS.find((d) => d.value === duration)?.label} session
                    </span>
                    <span className="tabular-nums font-medium">{formatDZD(basePrice)}</span>
                  </div>
                  {promoState === 'valid' && discountAmt > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                      <span>Promo code discount</span>
                      <span className="tabular-nums">− {formatDZD(discountAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold border-t border-border/60 pt-1.5 mt-1.5">
                    <span>
                      {finalPrice === 0 ? 'Free (promo applied)' : 'Total'}
                    </span>
                    <span className={cn('tabular-nums', finalPrice === 0 && 'text-emerald-700 dark:text-emerald-400')}>
                      {finalPrice === 0 ? 'Free' : formatDZD(finalPrice)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Admin confirms the exact amount after reviewing your request.
                  </p>
                </div>
              )}

              {/* Promo code — with real-time validation button */}
              <div className="space-y-1.5">
                <Label htmlFor="bc-promo" className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Tag className="size-3.5" /> Promo code{' '}
                  <span className="font-normal">(optional)</span>
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
                        Checking
                      </span>
                    ) : promoState === 'valid' ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <Check className="size-3" /> Applied
                      </span>
                    ) : (
                      <span className="text-xs">Apply</span>
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
                      ? `${promoDiscount}% discount applied`
                      : `${formatDZD(promoFixed)} discount applied`}
                  </div>
                )}
              </div>

              {/* Pending-review notice */}
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <Clock className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  Requests are reviewed by our team. You will receive a confirmation email once
                  approved — this is <strong>not</strong> an automatic booking.
                </span>
              </div>

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
                  onClick={() => handleOpenChange(false)}
                  disabled={formState === 'submitting'}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={formState === 'submitting'}>
                  <Calendar className="size-4" />
                  {feePerHour > 0
                    ? `Send request · ${finalPrice === 0 ? 'Free' : formatDZD(finalPrice)}`
                    : 'Send request'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
