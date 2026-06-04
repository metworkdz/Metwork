'use client';

/**
 * SpaceScheduler — the Airbnb-style "pick a date, then a time" surface for a
 * coworking space. It wraps the shared, presentational AvailabilityCalendar +
 * TimeSlotPicker and owns only the fetching of availability from the public
 * endpoint `GET /api/incubator/spaces/:id/availability`:
 *
 *   ?month=YYYY-MM → which days are selectable / blocked / fully-booked
 *   ?date=YYYY-MM-DD → the concrete hourly slots for the chosen day
 *
 * It is fully CONTROLLED by the booking form: it never owns the booking state,
 * it only reads `startDate/endDate/startTime/endTime/unit` and reports changes
 * through `onChange`. That keeps the booking payload and every server rule
 * (working hours, overlaps, the 7-hour cap → DAY conversion) exactly where they
 * already live — this component just surfaces them.
 *
 *   • HOUR  → single-day pick, then start/end time pills (capped at 7h, within
 *             working hours, overlapping hours disabled).
 *   • DAY/MONTH → date *range* pick; times pinned to opening/closing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AvailabilityCalendar } from '@/components/shared/availability-calendar';
import { TimeSlotPicker } from '@/components/shared/time-slot-picker';
import { cn } from '@/lib/utils';
import type { DaySlot } from '@/types/mentor';
import type { BookingUnit } from '@/types/booking';

type SchedulerLocale = 'en' | 'fr' | 'ar';

interface SpaceSchedulerChange {
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}

interface SpaceSchedulerProps {
  spaceId: string;
  openingTime: string;
  closingTime: string;
  unit: BookingUnit;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  onChange: (next: SpaceSchedulerChange) => void;
  locale?: SchedulerLocale;
  className?: string;
}

const MAX_HOURLY_MINUTES = 420; // 7 hours — mirrors the backend cap.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToTime(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

export function SpaceScheduler({
  spaceId,
  openingTime,
  closingTime,
  unit,
  startDate,
  endDate,
  startTime,
  endTime,
  onChange,
  locale = 'en',
  className,
}: SpaceSchedulerProps) {
  const t = useTranslations('spaces.scheduler');
  const isHour = unit === 'HOUR';

  const [month, setMonth] = useState<string>(() => (startDate || todayISO()).slice(0, 7));
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [unavailableDates, setUnavailableDates] = useState<string[]>([]);
  const [loadingDates, setLoadingDates] = useState(true);

  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // True while the user is mid-way through choosing a DAY/MONTH range
  // (start chosen, waiting for the end click).
  const [pickingEnd, setPickingEnd] = useState(false);
  const autoPickedRef = useRef(false);

  /* ── Fetch the month overview whenever the visible month changes ── */
  useEffect(() => {
    let cancelled = false;
    setLoadingDates(true);
    void fetch(`/api/incubator/spaces/${spaceId}/availability?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { availableDates?: string[]; unavailableDates?: string[] } | null) => {
        if (cancelled || !data) return;
        setAvailableDates(data.availableDates ?? []);
        setUnavailableDates(data.unavailableDates ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableDates([]);
          setUnavailableDates([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, month]);

  /* ── If the default date isn't selectable, advance to the first open day ── */
  useEffect(() => {
    if (autoPickedRef.current || loadingDates) return;
    if (month !== (startDate || '').slice(0, 7)) return;
    if (availableDates.includes(startDate)) {
      autoPickedRef.current = true;
      return;
    }
    const first = availableDates[0];
    if (first) {
      autoPickedRef.current = true;
      onChange({ startDate: first, endDate: first });
    }
  }, [availableDates, loadingDates, month, startDate, onChange]);

  /* ── Fetch hourly slots for the chosen day (HOUR only) ── */
  useEffect(() => {
    if (!isHour || !startDate) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    void fetch(`/api/incubator/spaces/${spaceId}/availability?date=${startDate}`)
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
  }, [spaceId, startDate, isHour]);

  /* ── Pin times to opening/closing while in DAY/MONTH mode ── */
  useEffect(() => {
    if (isHour) return;
    if (startTime !== openingTime || endTime !== closingTime) {
      onChange({ startTime: openingTime, endTime: closingTime });
    }
  }, [isHour, startTime, endTime, openingTime, closingTime, onChange]);

  /* ── Date selection ── */
  const handleSelectDate = useCallback(
    (date: string) => {
      if (isHour) {
        // Hourly bookings are single-day.
        onChange({ startDate: date, endDate: date });
        return;
      }
      // DAY / MONTH range selection.
      if (!pickingEnd) {
        onChange({ startDate: date, endDate: date });
        setPickingEnd(true);
      } else if (date >= startDate) {
        onChange({ endDate: date });
        setPickingEnd(false);
      } else {
        // Clicked before the current start → restart the range here.
        onChange({ startDate: date, endDate: date });
      }
    },
    [isHour, pickingEnd, startDate, onChange],
  );

  /* ── Hourly start/end pills ── */
  const slotAvail = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of slots) m.set(s.start, s.available);
    return m;
  }, [slots]);

  const rangeAvailable = useCallback(
    (from: string, to: string): boolean => {
      for (let m = toMin(from); m + 60 <= toMin(to); m += 60) {
        if (!slotAvail.get(minToTime(m))) return false;
      }
      return true;
    },
    [slotAvail],
  );

  // Candidate end times: every hour after the start, capped at start+7h and closing.
  const endSlots = useMemo<DaySlot[]>(() => {
    if (!isHour || !startTime) return [];
    const startMins = toMin(startTime);
    const ceiling = Math.min(startMins + MAX_HOURLY_MINUTES, toMin(closingTime));
    const out: DaySlot[] = [];
    for (let e = startMins + 60; e <= ceiling; e += 60) {
      const end = minToTime(e);
      out.push({ start: startTime, end, available: rangeAvailable(startTime, end) });
    }
    return out;
  }, [isHour, startTime, closingTime, rangeAvailable]);

  const onSelectStart = useCallback(
    (slot: DaySlot) => {
      // Default to a one-hour booking; the user can extend via the end pills.
      onChange({ startTime: slot.start, endTime: slot.end });
    },
    [onChange],
  );

  const noAvailability = !loadingDates && availableDates.length === 0 && unavailableDates.length === 0;
  const rangeEnd = !isHour && endDate && endDate !== startDate ? endDate : null;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="relative">
        <AvailabilityCalendar
          month={month}
          onMonthChange={setMonth}
          availableDates={availableDates}
          unavailableDates={unavailableDates}
          selectedDate={startDate}
          selectedRangeEnd={rangeEnd}
          onSelectDate={handleSelectDate}
          minDate={todayISO()}
          locale={locale}
        />
        {loadingDates && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-card/60 backdrop-blur-[1px]">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {noAvailability && (
          <p className="absolute inset-x-4 bottom-4 rounded-lg border border-dashed border-border/60 bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
            {t('noAvailabilityThisMonth')}
          </p>
        )}
      </div>

      {/* Range hint for multi-day bookings */}
      {!isHour && (
        <p className="text-center text-xs text-muted-foreground">
          {pickingEnd ? t('pickEndDate') : t('rangeHint')}
        </p>
      )}

      {/* Hourly time selection */}
      {isHour && (
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('startTime')}
            </p>
            {loadingSlots ? (
              <p className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('loadingTimes')}
              </p>
            ) : (
              <TimeSlotPicker
                slots={slots}
                selected={slots.some((s) => s.start === startTime) ? startTime : null}
                onSelect={onSelectStart}
                locale={locale}
              />
            )}
          </div>

          {!loadingSlots && endSlots.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('endTime')}
              </p>
              <div
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                role="group"
                aria-label={t('endTime')}
                className="flex flex-wrap gap-2"
              >
                {endSlots.map((slot) => {
                  const isSelected = slot.available && endTime === slot.end;
                  return (
                    <button
                      key={slot.end}
                      type="button"
                      disabled={!slot.available}
                      aria-pressed={isSelected}
                      onClick={() => slot.available && onChange({ endTime: slot.end })}
                      className={cn(
                        'inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-medium tabular-nums transition-colors duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : slot.available
                            ? 'border-border bg-background hover:border-primary/40 hover:bg-accent hover:text-accent-foreground'
                            : 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/50 line-through',
                      )}
                    >
                      <span dir="ltr">{slot.end}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('capHint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
