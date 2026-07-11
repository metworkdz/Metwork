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
import { Clock, UserCheck, Timer, DollarSign, Sparkles, CalendarClock } from 'lucide-react';
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
import { MentorScheduler } from '@/components/features/mentors/mentor-scheduler';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MentorBookingRecord, MentorBookingStatus, MentorRecord } from '@/server/db/store';
import type { DaySlot } from '@/types/mentor';
import type { Locale } from '@/i18n/config';
// Canonical duration options, pro-rata price, and price-state resolver — one
// source of truth shared with BookConsultationDialog and the public profile
// (replaces this panel's former local copies so the two never drift).
import { DURATION_OPTIONS, computePrice, resolveMentorPricing } from '@/lib/consultation-pricing';

function formatDZD(amount: number): string {
  return `${amount.toLocaleString('fr-DZ')} DZD`;
}

/**
 * Full ISO datetime with the local offset (e.g. "2026-05-20T14:00:00+01:00"),
 * so the server's 24h-advance check reasons about the intended wall-clock time
 * rather than flipping to the wrong UTC day near midnight.
 */
function buildLocalIso(dateStr: string, timeStr: string): string {
  const [y = 1970, mo = 1, d = 1] = dateStr.split('-').map(Number);
  const [h = 0, mi = 0] = timeStr.split(':').map(Number);
  const local = new Date(y, mo - 1, d, h, mi, 0, 0);
  const tzMin = -local.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const abs = Math.abs(tzMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}:00${off}`;
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
  /** When true, book through the instant-book, pay-first flow. */
  instantBookEnabled?: boolean;
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
  instantBookEnabled = false,
}: Props) {
  const t = useTranslations('pages.dashboard.entrepreneur.consultations.quotaCard');
  // Additional namespaces used inside the render tree below. Previously
  // referenced (tCommon, tAdminBookings) without being declared — a refactor
  // dropped the calls, leaving runtime ReferenceErrors that crashed the page.
  const tCommon         = useTranslations('common');
  const tAdminBookings  = useTranslations('admin.bookings');
  const [bookings, setBookings]     = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  const tConsult = useTranslations('consultantPortal.bookings');
  const schedulerLocale: 'en' | 'fr' | 'ar' =
    locale === 'fr' || locale === 'ar' ? locale : 'en';

  /* Reschedule state (member-initiated). */
  const [resBooking, setResBooking] = useState<MentorBookingRecord | null>(null);
  const [resDate, setResDate] = useState<string | null>(null);
  const [resTime, setResTime] = useState<string | null>(null);
  const [resBusy, setResBusy] = useState(false);
  const [resError, setResError] = useState<string | null>(null);

  /** Member can reschedule a settled, not-yet-completed session. */
  const RESCHEDULABLE_STATUSES: MentorBookingStatus[] = ['READY', 'AWAITING_LINK', 'CONFIRMED'];

  async function submitMemberReschedule() {
    if (!resBooking || !resDate || !resTime) return;
    setResBusy(true);
    setResError(null);
    try {
      const res = await fetch(`/api/consultations/${resBooking.id}/reschedule`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: resDate, time: resTime }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Reschedule failed');
      }
      const data = await res.json() as { scheduledAt: string | null };
      setBookings((prev) =>
        prev.map((b) =>
          b.id === resBooking.id
            ? { ...b, scheduledAt: data.scheduledAt, consultationDate: resDate, consultationTime: resTime }
            : b,
        ),
      );
      setResBooking(null);
      setResDate(null);
      setResTime(null);
    } catch (err) {
      setResError(err instanceof Error ? err.message : 'Reschedule failed');
    } finally {
      setResBusy(false);
    }
  }

  // Compute remaining if not explicitly provided.
  const remaining = typeof freeSessionsRemaining === 'number'
    ? freeSessionsRemaining
    : Math.max(0, freeQuota - freeSessionsUsed);

  // Show the prominent quota card only for paid tiers that grant free sessions.
  const showQuotaCard = !!membershipCode && freeQuota > 0;
  // Both naming systems map to the same display tiers: old membershipCode
  // (ENTREPRENEUR/STARTUP) and new membershipTier (BUILDER/FOUNDER).
  const tierLabel =
    membershipCode === 'ENTREPRENEUR' || membershipCode === 'BUILDER'
      ? t('tierBuilder')
      : membershipCode === 'STARTUP' || membershipCode === 'FOUNDER'
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
  // Exact chosen slot (date + hour-aligned start) for the new booking.
  const [bookDate, setBookDate] = useState<string | null>(null);
  const [bookTime, setBookTime] = useState<string | null>(null);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [useFreeCredit, setUseFreeCredit] = useState(false);
  // Free credits consumed in this client session (optimistic) — keeps the
  // dialog honest after a successful free booking without a server round-trip.
  const [freeUsedThisSession, setFreeUsedThisSession] = useState(0);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    mentorName: string;
    finalPrice: number;
    isFree: boolean;
  } | null>(null);

  /* Derived pricing */
  const remainingNow   = Math.max(0, remaining - freeUsedThisSession);
  const selectedMentor = mentors.find((m) => m.id === selectedMentorId);
  const { feePerHour, isPriced } = resolveMentorPricing(selectedMentor ?? {});
  const basePrice      = computePrice(feePerHour, duration);
  // A free monthly credit collapses the whole charge to 0 (promo suppressed) —
  // mirrors the server-authoritative math in computeConsultationCharge.
  const applyFreeCredit = useFreeCredit && remainingNow > 0 && basePrice > 0;
  const discountAmt    = applyFreeCredit ? 0 : (promoResult ? promoResult.discountAmount : 0);
  const finalPrice     = applyFreeCredit ? 0 : (promoResult ? promoResult.finalAmount : basePrice);
  const isFree         = feePerHour === 0 || finalPrice === 0;

  function openDialog() {
    setSelectedMentorId(mentors[0]?.id ?? '');
    setPhone(userPhone);
    setMessage('');
    setDuration(60);
    setBookDate(null);
    setBookTime(null);
    setPromoResult(null);
    // Members with a free session left expect it applied by default — same
    // behaviour as the public booking dialog.
    setUseFreeCredit(remaining - freeUsedThisSession > 0);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  /** When duration changes, reset the chosen slot (which hours fit changes) and promo. */
  function handleDurationChange(val: string) {
    setDuration(Number(val));
    setBookTime(null); // a longer/shorter session changes which starts fit
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
    if (!bookDate || !bookTime) {
      setError(t('errorPickSlot'));
      return;
    }

    setSaving(true);
    setError(null);

    // ── Instant-book, pay-first path ──────────────────────────────────────
    if (instantBookEnabled) {
      try {
        const res = await fetch(`/api/mentors/${selectedMentorId}/instant-book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name:    userName,
            email:   userEmail,
            phone:   phone.trim(),
            message: message.trim(),
            durationMinutes: duration,
            consultationDate: bookDate,
            consultationTime: bookTime,
            scheduledAt: buildLocalIso(bookDate, bookTime),
            // Promo is suppressed when a free credit applies (charge is already 0).
            promoCode: applyFreeCredit ? null : (promoResult?.code ?? null),
            // The server re-validates the quota — this flag is only a request.
            useFreeCredit: applyFreeCredit,
            locale,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          throw new Error(d.error?.message ?? t('errorBookingFailed'));
        }
        const data = await res.json() as { id: string; status: string; mode: 'confirmed' | 'awaiting_payment'; payToken?: string; redirectUrl?: string | null };
        if (data.mode === 'awaiting_payment') {
          if (data.redirectUrl) { window.location.href = data.redirectUrl; return; }
          if (data.payToken) { window.location.href = `/${locale}/consultation/pay/${data.payToken}`; return; }
        }
        const mentor = mentors.find((m) => m.id === selectedMentorId);
        setSuccess({ mentorName: mentor?.fullName ?? 'the mentor', finalPrice, isFree });
        if (applyFreeCredit) setFreeUsedThisSession((n) => n + 1);
        const now = new Date().toISOString();
        setBookings((prev) => [
          {
            id: data.id, mentorId: selectedMentorId, userId: null,
            userName, userEmail, userPhone: phone.trim(), message: message.trim(),
            status: (data.status as MentorBookingRecord['status']) ?? 'READY', adminNote: null,
            consultationDate: bookDate, consultationTime: bookTime, durationMinutes: duration,
            appliedPromoCode: promoResult?.code ?? null,
            promoDiscountPercent: promoResult ? promoResult.discountValue : null,
            createdAt: now, updatedAt: now,
          },
          ...prev,
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      } finally {
        setSaving(false);
      }
      return;
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
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => {
                    const mentor = mentors.find((m) => m.id === b.mentorId);
                    const canReschedule = RESCHEDULABLE_STATUSES.includes(b.status);
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
                        <TableCell className="text-end">
                          {canReschedule && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setResBooking(b); setResDate(null); setResTime(null); setResError(null); }}
                              title={tConsult('rescheduleCta')}
                            >
                              <CalendarClock className="size-4" />
                              <span className="sr-only">{tConsult('rescheduleCta')}</span>
                            </Button>
                          )}
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

      {/* Member reschedule dialog */}
      <Dialog open={resBooking !== null} onOpenChange={(o) => { if (!o) { setResBooking(null); setResDate(null); setResTime(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tConsult('rescheduleTitle')}</DialogTitle>
            <DialogDescription>{tConsult('rescheduleHelp')}</DialogDescription>
          </DialogHeader>
          {resBooking && (
            <MentorScheduler
              mentorId={resBooking.mentorId}
              selectedDate={resDate}
              onSelectDate={(d) => { setResDate(d); setResTime(null); }}
              selectedTime={resTime}
              onSelectTime={(slot: DaySlot) => setResTime(slot.start)}
              durationMinutes={resBooking.durationMinutes && resBooking.durationMinutes > 0 ? resBooking.durationMinutes : 60}
              locale={schedulerLocale}
            />
          )}
          {resError && <p className="text-xs text-destructive">{resError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResBooking(null)} disabled={resBusy}>
              {tConsult('dialogCancel')}
            </Button>
            <Button onClick={submitMemberReschedule} loading={resBusy} disabled={!resDate || !resTime}>
              {tConsult('rescheduleConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                      // Reset promo + chosen slot when mentor changes (fee + agenda differ)
                      setPromoResult(null);
                      setBookDate(null);
                      setBookTime(null);
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

                {/* Pick an exact date + hour-aligned slot (duration-aware). */}
                {selectedMentorId && (
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      <Timer className="size-3.5" /> {t('labelPickSlot')}
                    </Label>
                    <MentorScheduler
                      key={selectedMentorId}
                      mentorId={selectedMentorId}
                      selectedDate={bookDate}
                      onSelectDate={(d) => { setBookDate(d); setBookTime(null); }}
                      selectedTime={bookTime}
                      onSelectTime={(slot: DaySlot) => setBookTime(slot.start)}
                      durationMinutes={duration}
                      locale={schedulerLocale}
                    />
                  </div>
                )}

                {/* Unpriced mentor — say so plainly rather than implying "free". */}
                {selectedMentor && !isPriced && (
                  <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('pricingNotSet')}
                  </p>
                )}

                {/* Free-consultation credit — apply this month's quota.
                    Hidden entirely when 0 remaining (avoids confusing disabled state). */}
                {feePerHour > 0 && remainingNow > 0 && (
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
                      applyFreeCredit
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={applyFreeCredit}
                      onChange={(e) => setUseFreeCredit(e.target.checked)}
                      disabled={saving}
                      className="mt-0.5 size-4 shrink-0 accent-emerald-600"
                    />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 font-semibold">
                        <Sparkles className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        {t('useFreeCreditLabel')}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t('useFreeCreditRemaining', { remaining: remainingNow, quota: freeQuota })}
                      </span>
                    </span>
                  </label>
                )}

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
                    {applyFreeCredit && (
                      <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                        <span>{t('freeCreditApplied')}</span>
                        <span className="tabular-nums">− {formatDZD(basePrice)}</span>
                      </div>
                    )}
                    {promoResult && discountAmt > 0 && (
                      <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                        <span>{t('promoCodeDiscount')}</span>
                        <span className="tabular-nums">− {formatDZD(discountAmt)}</span>
                      </div>
                    )}
                    <div className={cn(
                      'flex justify-between text-sm font-semibold border-t border-border/60 pt-1.5 mt-1.5',
                    )}>
                      <span>
                        {finalPrice === 0
                          ? (applyFreeCredit ? t('freeCreditApplied') : t('freePromoApplied'))
                          : tCommon('total')}
                      </span>
                      <span className={cn('tabular-nums', finalPrice === 0 && 'text-emerald-700 dark:text-emerald-400')}>
                        {finalPrice === 0 ? tCommon('free') : formatDZD(finalPrice)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {t('feeConfirmNote')}
                    </p>
                  </div>
                )}

                {/* Promo code — pointless when a free credit already zeroes the charge */}
                {basePrice > 0 && !applyFreeCredit && (
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
                <Button loading={saving} onClick={submit} disabled={!bookDate || !bookTime}>
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
