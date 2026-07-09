'use client';

/**
 * MentorScheduler — the Airbnb-style "pick a date, then a time" surface for a
 * single mentor. It wraps the shared, presentational AvailabilityCalendar and
 * TimeSlotPicker and owns the only thing they don't: fetching availability from
 * the public endpoint `GET /api/mentors/:id/availability`.
 *
 *   ?from=&to=  → which dates in the visible month are selectable
 *   ?date=      → the concrete slots for the chosen day
 *
 * Selection is fully controlled by the parent (the booking dialog and the
 * profile page both reuse this), so there is exactly one fetching code path.
 */
import { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AvailabilityCalendar } from '@/components/shared/availability-calendar';
import { TimeSlotPicker } from '@/components/shared/time-slot-picker';
import { cn } from '@/lib/utils';
import type { DaySlot } from '@/types/mentor';

type SchedulerLocale = 'en' | 'fr' | 'ar';

interface MentorSchedulerProps {
  mentorId: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  selectedTime: string | null;
  onSelectTime: (slot: DaySlot) => void;
  locale?: SchedulerLocale;
  /** Notifies the parent once we know whether this mentor has any published availability. */
  onAvailabilityResolved?: (hasAvailability: boolean) => void;
  className?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** First and last calendar day (ISO) of a "YYYY-MM" month. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad2(last)}` };
}

/**
 * Manual-mode fallback slots for consultants who haven't published an agenda:
 * every 30 min from 08:00 to 19:30 (mentor local time). Starts inside the
 * 24h min-notice window are shown disabled; the server re-validates anyway.
 */
function manualDaySlots(date: string): DaySlot[] {
  const minStartMs = Date.now() + 24 * 60 * 60 * 1000;
  const out: DaySlot[] = [];
  for (let h = 8; h < 20; h++) {
    for (const m of [0, 30]) {
      const start = `${pad2(h)}:${pad2(m)}`;
      const endMinutes = h * 60 + m + 30;
      const end = `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;
      // Algeria is UTC+1 year-round — the fixed offset is exact.
      const startMs = Date.parse(`${date}T${start}:00+01:00`);
      out.push({ start, end, available: startMs >= minStartMs });
    }
  }
  return out;
}

export function MentorScheduler({
  mentorId,
  selectedDate,
  onSelectDate,
  selectedTime,
  onSelectTime,
  locale = 'en',
  onAvailabilityResolved,
  className,
}: MentorSchedulerProps) {
  const t = useTranslations('mentors.scheduler');
  const [month, setMonth] = useState<string>(() => todayISO().slice(0, 7));
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [loadingDates, setLoadingDates] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  // Tracks whether the mentor has ANY published availability across the fetched
  // window, so the parent can show a "request without a fixed time" fallback.
  const [everHadDates, setEverHadDates] = useState(false);

  // Fetch selectable dates for the visible month.
  useEffect(() => {
    let cancelled = false;
    const { from, to } = monthBounds(month);
    setLoadingDates(true);
    void fetch(`/api/mentors/${mentorId}/availability?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { availableDates?: string[]; timezone?: string } | null) => {
        if (cancelled || !data) return;
        const dates = data.availableDates ?? [];
        setAvailableDates(dates);
        if (data.timezone) setTimezone(data.timezone);
        if (dates.length > 0) setEverHadDates(true);
      })
      .catch(() => {
        if (!cancelled) setAvailableDates([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mentorId, month]);

  // Report availability resolution once the first month settles.
  useEffect(() => {
    if (!loadingDates) onAvailabilityResolved?.(everHadDates);
  }, [loadingDates, everHadDates, onAvailabilityResolved]);

  // Fetch concrete slots when a date is chosen.
  useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    void fetch(`/api/mentors/${mentorId}/availability?date=${selectedDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { slots?: DaySlot[] } | null) => {
        if (cancelled || !data) return;
        setSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mentorId, selectedDate]);

  const handleSelectDate = useCallback(
    (date: string) => {
      onSelectDate(date);
    },
    [onSelectDate],
  );

  // Manual mode: the consultant has not published any agenda — every future
  // day is selectable and generic half-hour start times are offered (the
  // server still enforces min-notice + overlap on submit). This is what lets
  // a client always pick a date AND a start time.
  const manualMode = !loadingDates && !everHadDates;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="relative">
        <AvailabilityCalendar
          month={month}
          onMonthChange={setMonth}
          availableDates={availableDates}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          minDate={todayISO()}
          locale={locale}
          mode={manualMode ? 'block' : 'select'}
        />
        {loadingDates && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-card/60 backdrop-blur-[1px]">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {timezone && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="size-3.5" />
          {t('timezoneNote', { timezone })}
        </p>
      )}

      {/* Slots for the chosen day */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('pickTime')}
        </p>
        {!selectedDate ? (
          <p className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            {t('pickDateFirst')}
          </p>
        ) : manualMode ? (
          <>
            <TimeSlotPicker
              slots={manualDaySlots(selectedDate)}
              selected={selectedTime}
              onSelect={onSelectTime}
              locale={locale}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t('manualTimeNote')}</p>
          </>
        ) : loadingSlots ? (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loadingTimes')}
          </p>
        ) : (
          <TimeSlotPicker
            slots={slots}
            selected={selectedTime}
            onSelect={onSelectTime}
            locale={locale}
          />
        )}
      </div>
    </div>
  );
}
