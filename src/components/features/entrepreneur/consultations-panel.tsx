'use client';

/**
 * Entrepreneur consultations panel.
 * Lists the user's consultation booking requests and lets them submit new ones.
 *
 * Booking flow:
 *   POST /api/mentors/:id/book  →  status: PENDING
 *   Admin reviews  →  APPROVED (confirmation email) | REJECTED
 *
 * Dialog features:
 *  - Mentor selector
 *  - Duration selector (30 – 180 min) with per-option DZD price
 *  - Price breakdown: base → promo discount → final
 *  - Promo code with real-time validation (shared PromoCodeInput)
 *  - Pending-review notice (not an automatic booking)
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, UserCheck, Timer, DollarSign, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { PromoCodeInput, type PromoResult } from '@/components/shared/promo-code-input';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MentorBookingRecord, MentorBookingStatus, MentorRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

/* ─── Duration options (mirrors BookConsultationDialog) ─── */

const DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2 h 30' },
  { value: 180, label: '3 hours' },
];

/** Compute session price from hourly rate and duration. Returns 0 for free mentors. */
function computePrice(feePerHour: number, durationMinutes: number): number {
  if (!feePerHour || feePerHour <= 0) return 0;
  return Math.round((durationMinutes / 60) * feePerHour);
}

function formatDZD(amount: number): string {
  return `${amount.toLocaleString('fr-DZ')} DZD`;
}

/* ─── Props ─── */

interface Props {
  /** Existing mentor booking requests for this user, newest first. */
  initial:        MentorBookingRecord[];
  mentors:        MentorRecord[];
  /** How many free consultations this user's plan includes per month (for display). */
  freeQuota:      number;
  /** Free quota already consumed this calendar month. */
  freeSessionsUsed?:      number;
  /** Free sessions still available this month. */
  freeSessionsRemaining?: number;
  /** ISO timestamp (UTC) when the quota resets — typically the 1st of next month. */
  quotaResetISO?:         string;
  membershipCode: string | null;
  locale:         Locale;
  /** Pre-filled from the user's profile. */
  userName:       string;
  userEmail:      string;
  userPhone:      string;
}

function StatusBadge({ status }: { status: MentorBookingStatus }) {
  const tMB = useTranslations('admin.mentorBookings');
  const tAB = useTranslations('admin.bookings');
  // Positive / completed
  if (status === 'APPROVED')  return <Badge variant="success">{tMB('filterApproved')}</Badge>;
  if (status === 'READY')     return <Badge variant="success">{tMB('statusReady')}</Badge>;
  if (status === 'CONFIRMED') return <Badge variant="primary">{tMB('statusConfirmed')}</Badge>;
  if (status === 'COMPLETED') return <Badge variant="primary">{tMB('statusCompleted')}</Badge>;
  // Negative
  if (status === 'REJECTED')  return <Badge variant="danger">{tMB('filterRejected')}</Badge>;
  if (status === 'CANCELLED') return <Badge variant="danger">{tMB('statusCancelled')}</Badge>;
  // Awaiting payment / meeting link
  if (status === 'AWAITING_PAYMENT') return <Badge variant="info">{tMB('statusAwaitingPayment')}</Badge>;
  if (status === 'PENDING_PAYMENT')  return <Badge variant="info">{tMB('statusPendingPayment')}</Badge>;
  if (status === 'AWAITING_LINK')    return <Badge variant="info">{tMB('statusAwaitingLink')}</Badge>;
  // PENDING (default — unchanged label)
  return <Badge variant="warning">{tAB('pendingReview')}</Badge>;
}

/* ─── Component ─── */

export function ConsultationsPanel({
  initial,
  mentors,
  freeQuota,
  freeSessionsUsed = 0,
  freeSessionsRemaining,
  quotaResetISO,
  membershipCode,
  locale,
  userName,
  userEmail,
  userPhone,
}: Props) {
  const t = useTranslations('pages.dashboard.entrepreneur.consultations.quotaCard');
  // Additional namespaces used inside the render tree below. Previously
  // referenced (tCommon, tAdminBookings) without being declared — a refactor
  // dropped the calls, leaving runtime ReferenceErrors that crashed the page.
  const tCommon         = useTranslations('common');
  const tAdminBookings  = useTranslations('admin.bookings');
  const [bookings, setBookings]     = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Compute remaining if not explicitly provided.
  const remaining = typeof freeSessionsRemaining === 'number'
    ? freeSessionsRemaining
    : Math.max(0, freeQuota - freeSessionsUsed);

  // Show the prominent quota card only for paid tiers that grant free sessions.
  const showQuotaCard = !!membershipCode && freeQuota > 0;
  const tierLabel = membershipCode === 'ENTREPRENEUR'
    ? t('tierBuilder')
    : membershipCode === 'STARTUP'
      ? t('tierFounder')
      : '';
  const resetDateLabel = quotaResetISO
    ? formatDate(quotaResetISO, locale, { dateStyle: 'long' })
    : '';

  /* Dialog form state */
  const [selectedMentorId, setSelectedMentorId] = useState('');
  const [phone,    setPhone]    = useState(userPhone);
  const [message,  setMessage]  = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    mentorName: string;
    finalPrice: number;
    isFree: boolean;
  } | null>(null);

  /* Derived pricing */
  const selectedMentor = mentors.find((m) => m.id === selectedMentorId);
  const feePerHour     = selectedMentor?.consultationFee ?? 0;
  const basePrice      = computePrice(feePerHour, duration);
  const discountAmt    = promoResult ? promoResult.discountAmount : 0;
  const finalPrice     = promoResult ? promoResult.finalAmount : basePrice;
  const isFree         = feePerHour === 0 || finalPrice === 0;

  function openDialog() {
    setSelectedMentorId(mentors[0]?.id ?? '');
    setPhone(userPhone);
    setMessage('');
    setDuration(60);
    setPromoResult(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  /** When duration changes, reset any applied promo (base price changed). */
  function handleDurationChange(val: string) {
    setDuration(Number(val));
    setPromoResult(null); // reset so PromoCodeInput remounts fresh
  }

  async function submit() {
    if (!selectedMentorId) {
      setError(t('errorSelectMentor'));
      return;
    }
    if (phone.trim().length < 6) {
      setError(t('errorInvalidPhone'));
      return;
    }
    if (message.trim().length < 10) {
      setError(t('errorMessageTooShort'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/mentors/${selectedMentorId}/book`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name:             userName,
          email:            userEmail,
          phone:            phone.trim(),
          message:          message.trim(),
          consultationDate: null,
          consultationTime: null,
          durationMinutes:  duration,
          promoCode:        promoResult?.code ?? null,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? t('errorBookingFailed'));
      }

      const data = await res.json() as { id: string };
      const mentor = mentors.find((m) => m.id === selectedMentorId);

      setSuccess({
        mentorName: mentor?.fullName ?? 'the mentor',
        finalPrice,
        isFree,
      });

      /* Optimistic insert with PENDING status */
      const now = new Date().toISOString();
      setBookings((prev) => [
        {
          id:                   data.id,
          mentorId:             selectedMentorId,
          userId:               null,
          userName,
          userEmail,
          userPhone:            phone.trim(),
          message:              message.trim(),
          status:               'PENDING' as const,
          adminNote:            null,
          consultationDate:     null,
          consultationTime:     null,
          durationMinutes:      duration,
          appliedPromoCode:     promoResult?.code ?? null,
          promoDiscountPercent: promoResult ? promoResult.discountValue : null,
          createdAt:            now,
          updatedAt:            now,
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Prominent free-quota stat card — only for paid tiers with a free quota */}
      {showQuotaCard && (
        <div className="overflow-hidden rounded-xl border border-primary-200 bg-gradient-to-br from-primary-50 via-primary-50/70 to-background px-5 py-5 shadow-sm dark:border-primary-900/60 dark:from-primary-950/40 dark:via-primary-950/20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-primary-300">
                    {t('label')}
                  </p>
                  {tierLabel && (
                    <Badge variant="primary" className="text-[10px] uppercase tracking-wide">
                      {tierLabel}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {t('remaining', { remaining, quota: freeQuota })}
                </p>
                {resetDateLabel && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {remaining === 0
                      ? t('resetsZero', { date: resetDateLabel })
                      : t('resets', { date: resetDateLabel })}
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-md bg-background/70 px-3 py-2 text-right text-xs text-muted-foreground dark:bg-background/40">
              <p className="font-medium text-foreground">
                {t('usedOf', { used: freeSessionsUsed, quota: freeQuota })}
              </p>
              <p className="mt-0.5">{t('thisMonth')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quota / plan info banner */}
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {freeQuota > 0 ? (
              <>
                {t('bannerFreeQuota', {
                  count: freeQuota,
                  plural: freeQuota !== 1 ? 's' : '',
                })}
              </>
            ) : membershipCode ? (
              <>{t('bannerAvailableOnRequest')}</>
            ) : (
              <>{t('bannerUpgradeCta')}</>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('bannerReviewNotice')}
          </p>
        </div>
        <Button size="sm" onClick={openDialog} disabled={mentors.length === 0}>
          {t('bookSession')}
        </Button>
      </div>

      {/* Booking history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {bookings.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
              icon={<UserCheck className="size-5 text-muted-foreground" />}
              action={
                <Button size="sm" onClick={openDialog} disabled={mentors.length === 0}>
                  {t('bookFirstSession')}
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colMentor')}</TableHead>
                    <TableHead>{tCommon('status')}</TableHead>
                    <TableHead>{t('colDuration')}</TableHead>
                    <TableHead>{t('colSubmitted')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => {
                    const mentor = mentors.find((m) => m.id === b.mentorId);
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">
                          {mentor?.fullName ?? b.userName}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={b.status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.durationMinutes ? `${b.durationMinutes} min` : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(b.createdAt, locale, { dateStyle: 'medium' })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => { if (!open && !saving) setDialogOpen(false); }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          {success ? (
            /* ── Pending-approval success state ── */
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950">
                <Clock className="size-7 text-amber-500 dark:text-amber-400" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">{t('successHeading')}</h2>
              <Badge variant="warning" className="mt-2">{tAdminBookings('pendingReview')}</Badge>
              <p className="mt-3 text-sm text-muted-foreground max-w-xs">
                {t('successBody', { mentorName: success.mentorName })}
              </p>
              {!success.isFree && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('estimatedFeeLabel', { fee: formatDZD(success.finalPrice) })}
                  {discountAmt > 0 && (
                    <span className="ml-1 text-emerald-700">
                      {t('promoDiscountApplied', { discount: formatDZD(discountAmt) })}
                    </span>
                  )}
                </p>
              )}
              <Button className="mt-6" onClick={() => setDialogOpen(false)}>
                {t('done')}
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('dialogTitle')}</DialogTitle>
                <DialogDescription>
                  {t('dialogDescription')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Mentor selector */}
                <div className="space-y-1.5">
                  <Label>{t('labelMentor')}</Label>
                  <Select
                    value={selectedMentorId}
                    onValueChange={(v) => {
                      setSelectedMentorId(v);
                      // Reset promo when mentor changes (fee may differ)
                      setPromoResult(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('placeholderSelectMentor')} />
                    </SelectTrigger>
                    <SelectContent>
                      {mentors.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.fullName} — {m.position}
                          {(m.consultationFee ?? 0) > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              · {formatDZD(m.consultationFee!)} /hr
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedMentor?.bio && (
                    <p className="text-xs text-muted-foreground">{selectedMentor.bio}</p>
                  )}
                </div>

                {/* Duration selector */}
                <div className="space-y-1.5">
                  <Label htmlFor="cp-dur" className="flex items-center gap-1">
                    <Timer className="size-3.5" /> {t('labelDuration')}
                  </Label>
                  <Select
                    value={String(duration)}
                    onValueChange={handleDurationChange}
                    disabled={saving}
                  >
                    <SelectTrigger id="cp-dur">
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

                {/* Price breakdown — only shown when mentor has a fee */}
                {feePerHour > 0 && (
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      <DollarSign className="size-3.5" /> {t('estimatedFeeHeading')}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t('sessionLabel', { duration: DURATION_OPTIONS.find((d) => d.value === duration)?.label ?? '' })}
                      </span>
                      <span className="tabular-nums font-medium">{formatDZD(basePrice)}</span>
                    </div>
                    {promoResult && discountAmt > 0 && (
                      <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                        <span>{t('promoCodeDiscount')}</span>
                        <span className="tabular-nums">− {formatDZD(discountAmt)}</span>
                      </div>
                    )}
                    <div className={cn(
                      'flex justify-between text-sm font-semibold border-t border-border/60 pt-1.5 mt-1.5',
                    )}>
                      <span>{finalPrice === 0 ? t('freePromoApplied') : tCommon('total')}</span>
                      <span className={cn('tabular-nums', finalPrice === 0 && 'text-emerald-700 dark:text-emerald-400')}>
                        {finalPrice === 0 ? tCommon('free') : formatDZD(finalPrice)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {t('feeConfirmNote')}
                    </p>
                  </div>
                )}

                {/* Promo code */}
                {basePrice > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t('labelPromoCode')} <span className="font-normal">{t('optionalHint')}</span>
                    </Label>
                    {/* key forces remount when duration/mentor changes so state resets */}
                    <PromoCodeInput
                      key={`${selectedMentorId}-${duration}`}
                      originalAmount={basePrice}
                      onApplied={setPromoResult}
                      disabled={saving}
                    />
                  </div>
                )}

                {/* Phone (pre-filled, editable) */}
                <div className="space-y-1.5">
                  <Label htmlFor="cp-phone">{t('labelPhone')}</Label>
                  <Input
                    id="cp-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+213 555 00 00 00"
                    dir="ltr"
                    disabled={saving}
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <Label htmlFor="cp-msg">{t('labelMessage')}</Label>
                  <textarea
                    id="cp-msg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    placeholder={t('messagePlaceholder')}
                    disabled={saving}
                    className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('messageMinHint', { count: message.length })}
                  </p>
                </div>

                {/* Pending-review notice */}
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <Clock className="size-3.5 mt-0.5 shrink-0" />
                  <span>{t('reviewNotice')}</span>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button loading={saving} onClick={submit}>
                  {feePerHour > 0
                    ? (finalPrice === 0
                        ? t('sendRequestFree')
                        : t('sendRequestWithPrice', { price: formatDZD(finalPrice) }))
                    : t('sendRequest')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
