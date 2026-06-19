'use client';

/**
 * Admin consultation oversight — READ-ONLY.
 *
 * The legacy approve/decline gate was retired: instant-book is now the only
 * consultation flow (a booking is paid up front and auto-confirmed, with no
 * admin review). This table keeps full visibility (filters + status + the
 * non-sensitive summary) so admins can monitor bookings, but it no longer
 * exposes an approval action. Acting on a booking on the consultant's behalf
 * (set meeting link / mark complete) lives in the dedicated admin endpoints.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, Clock, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
  // Legacy (admin-approval era) — retained for any historical rows.
  PENDING:          { variant: 'warning', labelKey: 'statusPending' },
  APPROVED:         { variant: 'success', labelKey: 'statusApproved' },
  REJECTED:         { variant: 'danger',  labelKey: 'statusRejected' },
  AWAITING_PAYMENT: { variant: 'info',    labelKey: 'statusAwaitingPayment' },
  CONFIRMED:        { variant: 'primary', labelKey: 'statusConfirmed' },
  // Canonical (instant-book, pay-first)
  PENDING_PAYMENT:  { variant: 'warning', labelKey: 'statusPendingPayment' },
  AWAITING_LINK:    { variant: 'info',    labelKey: 'statusAwaitingLink' },
  READY:            { variant: 'success', labelKey: 'statusReady' },
  COMPLETED:        { variant: 'primary', labelKey: 'statusCompleted' },
  CANCELLED:        { variant: 'danger',  labelKey: 'statusCancelled' },
};

interface MentorBookingsTableProps {
  initial: BookingRow[];
}

export function MentorBookingsTable({ initial }: MentorBookingsTableProps) {
  const t = useTranslations('admin.mentorBookings');
  const [rows] = useState<BookingRow[]>(initial);
  const [statusFilter, setFilter] = useState<MentorBookingStatus | 'ALL'>('ALL');

  const filters: Array<{ value: MentorBookingStatus | 'ALL'; label: string }> = [
    { value: 'ALL',              label: t('filterAll') },
    { value: 'PENDING_PAYMENT',  label: t('filterPendingPayment') },
    { value: 'AWAITING_PAYMENT', label: t('filterAwaitingPayment') },
    { value: 'AWAITING_LINK',    label: t('filterAwaitingLink') },
    { value: 'READY',            label: t('filterReady') },
    { value: 'CONFIRMED',        label: t('filterConfirmed') },
    { value: 'COMPLETED',        label: t('filterCompleted') },
    { value: 'CANCELLED',        label: t('filterCancelled') },
  ];

  const visible = statusFilter === 'ALL'
    ? rows
    : rows.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/20 p-1 w-fit">
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
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => {
            const badge = STATUS_BADGE[row.status];
            return (
              <Card key={row.id} className="border-border/60">
                <CardContent className="p-4">
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
