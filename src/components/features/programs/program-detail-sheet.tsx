'use client';

/**
 * Right-side sheet with the program detail view + inline apply form.
 * Fetches live attendance and the caller's apply status when opened.
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { CalendarRange, Clock, MapPin, Users } from 'lucide-react';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProgramImage } from './program-image';
import { programTypeLabel } from './program-meta';
import { ProgramApplyForm, ProgramApplySuccess } from './program-apply-form';
import { bookingService } from '@/services/booking.service';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Program } from '@/types/domain';
import type { BookingDto, ItemAttendanceStatus } from '@/types/booking';

interface ProgramDetailSheetProps {
  program: Program | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProgramDetailSheet({ program, open, onOpenChange }: ProgramDetailSheetProps) {
  const locale = useLocale() as Locale;
  const [status, setStatus] = useState<ItemAttendanceStatus | null>(null);
  const [success, setSuccess] = useState<{ booking: BookingDto; newBalance: number; paid: boolean } | null>(null);

  // Reset success when sheet closes or program changes.
  useEffect(() => {
    if (!open) {
      setSuccess(null);
      setStatus(null);
    }
  }, [open]);
  useEffect(() => {
    setSuccess(null);
  }, [program?.id]);

  // Fetch attendance + my-status when the sheet opens for a program.
  useEffect(() => {
    if (!program || !open) return;
    let cancelled = false;
    void bookingService
      .getProgramStatus(program.id)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // swallow — the apply form gracefully handles missing status
      });
    return () => {
      cancelled = true;
    };
  }, [program, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {program ? (
          <>
            <div className="relative h-56 w-full shrink-0">
              <ProgramImage type={program.type} imageUrl={program.imageUrl} alt={program.title} />
              <div className="absolute start-4 top-4 inline-flex items-center gap-1 rounded-full bg-foreground/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-background">
                {programTypeLabel[program.type]}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
              <h2 className="text-2xl font-semibold tracking-tight">{program.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {program.city} · {program.incubatorName}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" />
                  {(status?.taken ?? program.seatsTaken)}/{program.seatsTotal} enrolled
                </span>
              </div>

              <p className="mt-5 text-sm leading-relaxed text-foreground">
                {program.description}
              </p>

              {/* Cohort details */}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <DetailTile
                  icon={<CalendarRange className="size-4" />}
                  label="Cohort dates"
                  value={`${formatDate(program.startDate, locale)} → ${formatDate(program.endDate, locale)}`}
                />
                <DetailTile
                  icon={<Clock className="size-4" />}
                  label="Application deadline"
                  value={formatDate(program.deadline, locale, { dateStyle: 'medium' })}
                  hint={status?.deadline ? formatRelativeTime(status.deadline, locale) : undefined}
                  hintTone={status?.deadlinePassed ? 'danger' : 'default'}
                />
                <DetailTile
                  icon={<Users className="size-4" />}
                  label="Cohort size"
                  value={`${program.seatsTotal} seats`}
                  hint={
                    status
                      ? `${Math.max(0, status.capacity - status.taken)} left`
                      : `${Math.max(0, program.seatsTotal - program.seatsTaken)} left`
                  }
                />
                <DetailTile
                  icon={<Badge variant="primary" className="text-[10px]">FEE</Badge>}
                  label="Application fee"
                  value={
                    program.price === 0
                      ? 'Free'
                      : formatCurrency(program.price, locale)
                  }
                />
              </div>

              <div className="my-6 border-t border-border" />

              {success ? (
                <div className="space-y-4">
                  <ProgramApplySuccess
                    booking={success.booking}
                    newBalance={success.newBalance}
                    paid={success.paid}
                  />
                  <SheetClose asChild>
                    <Button variant="outline" className="w-full">
                      Close
                    </Button>
                  </SheetClose>
                </div>
              ) : (
                <ProgramApplyForm
                  program={program}
                  status={status}
                  onSuccess={(booking, newBalance) =>
                    setSuccess({ booking, newBalance, paid: program.price > 0 })
                  }
                />
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailTile({
  icon,
  label,
  value,
  hint,
  hintTone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'default' | 'danger';
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-medium">{value}</p>
      {hint && (
        <p
          className={
            hintTone === 'danger'
              ? 'mt-0.5 text-xs text-destructive'
              : 'mt-0.5 text-xs text-muted-foreground'
          }
        >
          {hint}
        </p>
      )}
    </div>
  );
}
