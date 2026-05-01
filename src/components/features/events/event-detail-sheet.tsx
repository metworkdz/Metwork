'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { CalendarDays, Clock, MapPin, Users, Wifi } from 'lucide-react';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EventDateBlock } from './event-date-block';
import {
  EventRegisterForm,
  EventRegisterSuccess,
} from './event-register-form';
import { bookingService } from '@/services/booking.service';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Event as PlatformEvent } from '@/types/domain';
import type { BookingDto, ItemAttendanceStatus } from '@/types/booking';

interface EventDetailSheetProps {
  event: PlatformEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventDetailSheet({ event, open, onOpenChange }: EventDetailSheetProps) {
  const locale = useLocale() as Locale;
  const [status, setStatus] = useState<ItemAttendanceStatus | null>(null);
  const [success, setSuccess] = useState<{ booking: BookingDto; newBalance: number; paid: boolean } | null>(null);

  useEffect(() => {
    if (!open) {
      setSuccess(null);
      setStatus(null);
    }
  }, [open]);
  useEffect(() => {
    setSuccess(null);
  }, [event?.id]);

  useEffect(() => {
    if (!event || !open) return;
    let cancelled = false;
    void bookingService
      .getEventStatus(event.id)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [event, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {event ? (
          <>
            <EventDateBlock
              iso={event.eventDate}
              locale={locale}
              className="h-44 w-full shrink-0"
            />
            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                {event.isOnline ? (
                  <Badge variant="info" className="gap-1">
                    <Wifi className="size-3" />
                    Online
                  </Badge>
                ) : (
                  <Badge variant="outline">In person</Badge>
                )}
                {status?.eventPassed && <Badge variant="default">Past event</Badge>}
              </div>

              <h2 className="mt-3 text-2xl font-semibold tracking-tight">{event.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {event.city} · {event.incubatorName}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" />
                  {(status?.taken ?? event.attendeeCount)}/{event.capacity} registered
                </span>
              </div>

              <p className="mt-5 text-sm leading-relaxed text-foreground">
                {event.description}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <DetailTile
                  icon={<CalendarDays className="size-4" />}
                  label="Date"
                  value={formatDate(event.eventDate, locale, { dateStyle: 'full' })}
                />
                <DetailTile
                  icon={<Clock className="size-4" />}
                  label="Starts"
                  value={formatDate(event.eventDate, locale, { timeStyle: 'short' })}
                  hint={formatRelativeTime(event.eventDate, locale)}
                />
                <DetailTile
                  icon={<Users className="size-4" />}
                  label="Capacity"
                  value={`${event.capacity} attendees`}
                  hint={
                    status
                      ? `${Math.max(0, status.capacity - status.taken)} left`
                      : `${Math.max(0, event.capacity - event.attendeeCount)} left`
                  }
                />
                <DetailTile
                  icon={<Badge variant="primary" className="text-[10px]">FEE</Badge>}
                  label="Ticket"
                  value={event.price === 0 ? 'Free' : formatCurrency(event.price, locale)}
                />
              </div>

              <div className="my-6 border-t border-border" />

              {success ? (
                <div className="space-y-4">
                  <EventRegisterSuccess
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
                <EventRegisterForm
                  event={event}
                  status={status}
                  onSuccess={(booking, newBalance) =>
                    setSuccess({ booking, newBalance, paid: event.price > 0 })
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-medium">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
