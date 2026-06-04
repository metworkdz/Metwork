'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X, ChevronDown, Calendar, Clock, Timer, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { MentorBookingStatus } from '@/server/db/store';

export interface BookingRow {
  id: string;
  mentorId: string;
  mentorName: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  message: string;
  scheduledAt?: string | null;
  meetLink?: string | null;
  isOffline?: boolean;
  status: MentorBookingStatus;
  adminNote: string | null;
  consultationDate?: string | null;
  consultationTime?: string | null;
  durationMinutes?: number | null;
  /** 'guest' for pay-after-approval requests; absent/undefined = registered. */
  source?: 'registered' | 'guest';
  paymentStatus?: 'UNPAID' | 'AWAITING_PAYMENT' | 'PAID';
  guestAmountDue?: number | null;
  createdAt: string;
  updatedAt: string;
}

type BadgeVariant = 'warning' | 'success' | 'danger' | 'info' | 'primary';

const STATUS_BADGE: Record<MentorBookingStatus, { variant: BadgeVariant; labelKey: string }> = {
  PENDING:          { variant: 'warning', labelKey: 'statusPending' },
  APPROVED:         { variant: 'success', labelKey: 'statusApproved' },
  REJECTED:         { variant: 'danger',  labelKey: 'statusRejected' },
  AWAITING_PAYMENT: { variant: 'info',    labelKey: 'statusAwaitingPayment' },
  CONFIRMED:        { variant: 'primary', labelKey: 'statusConfirmed' },
};

interface ReviewDialogProps {
  booking: BookingRow | null;
  onClose: () => void;
  onSave: (id: string, payload: {
    status: 'APPROVED' | 'REJECTED';
    adminNote?: string;
    scheduledAt?: string;
    meetLink?: string;
    isOffline?: boolean;
  }) => Promise<void>;
}

function ReviewDialog({ booking, onClose, onSave }: ReviewDialogProps) {
  const t = useTranslations('admin.mentorBookings');
  const [note,        setNote]        = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [meetLink,    setMeetLink]    = useState('');
  const [isOffline,   setIsOffline]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  // Derived: approve is allowed when meetLink is filled OR offline is checked
  const approveReady = meetLink.trim().length > 0 || isOffline;

  async function submit(status: 'APPROVED' | 'REJECTED') {
    if (!booking) return;

    if (status === 'APPROVED' && !approveReady) {
      setErrorMsg(t('approveValidationError'));
      return;
    }

    setSaving(true); setErrorMsg(null);
    try {
      await onSave(booking.id, {
        status,
        adminNote:   note || undefined,
        scheduledAt: status === 'APPROVED' && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : undefined,
        meetLink:  status === 'APPROVED' && meetLink.trim() ? meetLink.trim() : undefined,
        isOffline: status === 'APPROVED' ? isOffline : undefined,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={booking !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('reviewDialogTitle')}</DialogTitle>
          {booking && (
            <DialogDescription>
              {booking.userName} → {booking.mentorName}
            </DialogDescription>
          )}
        </DialogHeader>

        {booking && (
          <div className="space-y-4">
            {/* Booking info */}
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm space-y-1">
              <p><span className="font-medium">{t('emailLabel')}:</span> {booking.userEmail}</p>
              <p><span className="font-medium">{t('phoneLabel')}:</span> {booking.userPhone}</p>
              {booking.scheduledAt && (
                <p>
                  <span className="font-medium">{t('preferredTimeLabel')}:</span>{' '}
                  {new Date(booking.scheduledAt).toLocaleString()}
                </p>
              )}
              <p className="mt-2 text-muted-foreground">{booking.message}</p>
            </div>

            {/* Meeting details — required for approval */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rev-scheduled">
                  {t('confirmedDateTimeLabel')} <span className="text-muted-foreground text-xs">{t('confirmedDateTimeHint')}</span>
                </Label>
                <Input
                  id="rev-scheduled"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={saving}
                />
              </div>

              {/* Offline toggle */}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                <input
                  type="checkbox"
                  checked={isOffline}
                  onChange={(e) => {
                    setIsOffline(e.target.checked);
                    if (e.target.checked) setMeetLink('');
                    setErrorMsg(null);
                  }}
                  disabled={saving}
                  className="size-4 rounded"
                />
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{t('offlineLabel')}</span>
              </label>

              {/* Meet link — hidden when offline */}
              {!isOffline && (
                <div className="space-y-1.5">
                  <Label htmlFor="rev-meet">
                    {t('meetingLinkLabel')} <span className="text-destructive text-xs">{t('meetingLinkRequired')}</span>
                  </Label>
                  <Input
                    id="rev-meet"
                    type="url"
                    value={meetLink}
                    onChange={(e) => { setMeetLink(e.target.value); setErrorMsg(null); }}
                    placeholder={t('meetingLinkPlaceholder')}
                    disabled={saving}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="admin-note">{t('noteLabel')} <span className="text-muted-foreground text-xs">{t('noteHint')}</span></Label>
                <textarea
                  id="admin-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder={t('notePlaceholder')}
                  disabled={saving}
                  className={cn(
                    'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
                    'placeholder:text-muted-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                />
              </div>
            </div>

            {errorMsg && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errorMsg}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={saving}
            onClick={() => submit('REJECTED')}
          >
            <X className="size-4" /> {t('reject')}
          </Button>
          <Button
            loading={saving}
            disabled={!approveReady}
            title={!approveReady ? t('approveTooltip') : undefined}
            onClick={() => submit('APPROVED')}
          >
            <Check className="size-4" /> {t('approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MentorBookingsTableProps {
  initial: BookingRow[];
}

export function MentorBookingsTable({ initial }: MentorBookingsTableProps) {
  const t = useTranslations('admin.mentorBookings');
  const [rows,         setRows]      = useState<BookingRow[]>(initial);
  const [reviewing,    setReviewing] = useState<BookingRow | null>(null);
  const [statusFilter, setFilter]    = useState<MentorBookingStatus | 'ALL'>('ALL');

  const filters: Array<{ value: MentorBookingStatus | 'ALL'; label: string }> = [
    { value: 'ALL',              label: t('filterAll') },
    { value: 'PENDING',          label: t('filterPending') },
    { value: 'AWAITING_PAYMENT', label: t('filterAwaitingPayment') },
    { value: 'CONFIRMED',        label: t('filterConfirmed') },
    { value: 'APPROVED',         label: t('filterApproved') },
    { value: 'REJECTED',         label: t('filterRejected') },
  ];

  const visible = statusFilter === 'ALL'
    ? rows
    : rows.filter((r) => r.status === statusFilter);

  async function handleSave(
    id: string,
    payload: { status: 'APPROVED' | 'REJECTED'; adminNote?: string; scheduledAt?: string; meetLink?: string; isOffline?: boolean },
  ) {
    const res = await fetch(`/api/admin/mentor-bookings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(data.error?.message ?? 'Failed to update booking');
    }
    const updated = (await res.json()) as BookingRow;
    setRows((prev) =>
      prev.map((r) => r.id === id ? { ...r, ...updated } : r),
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/20 p-1 w-fit">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === f.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            {f.value !== 'ALL' && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                ({rows.filter((r) => r.status === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No booking requests{statusFilter !== 'ALL' ? ` with status "${statusFilter}"` : ''} yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => {
            const badge = STATUS_BADGE[row.status];
            return (
              <Card key={row.id} className="border-border/60">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground truncate">{row.userName}</p>
                        <span className="text-muted-foreground">→</span>
                        <p className="text-sm font-medium text-primary truncate">{row.mentorName}</p>
                        <Badge variant={badge.variant} className="text-xs">
                          {t(badge.labelKey)}
                        </Badge>
                        {row.source === 'guest' && (
                          <Badge variant="outline" className="text-xs">
                            {t('guestBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.userEmail} · {row.userPhone}
                      </p>
                      {row.consultationDate && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="size-3" />
                            {row.consultationDate}
                          </span>
                          {row.consultationTime && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3" />
                              {row.consultationTime}
                            </span>
                          )}
                          {row.durationMinutes && (
                            <span className="inline-flex items-center gap-1">
                              <Timer className="size-3" />
                              {t('durationMin', { min: row.durationMinutes })}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                        {row.message}
                      </p>
                      {row.adminNote && (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          {t('notePrefix')}{row.adminNote}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/60">
                        {t('submittedAt', { date: new Date(row.createdAt).toLocaleString() })}
                      </p>
                    </div>

                    {row.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setReviewing(row)}
                      >
                        {t('reviewButton')}
                        <ChevronDown className="size-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ReviewDialog
        booking={reviewing}
        onClose={() => setReviewing(null)}
        onSave={handleSave}
      />
    </div>
  );
}
