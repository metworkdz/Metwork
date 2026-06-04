'use client';

/**
 * FixedDateCalendar — a read-only month grid that *marks* the fixed date(s) of a
 * program or event. It reuses the presentational AvailabilityCalendar but never
 * lets the user pick: selection is a no-op. It only surfaces, at a glance,
 * whether the item is still bookable.
 *
 *   • open   → the date / range is highlighted in brand green.
 *   • full   → the date / range is greyed (struck) with a "fully booked" caption.
 *   • closed → same, with a "registration closed / past" caption.
 *
 * Business rules are untouched — capacity and deadlines are decided server-side;
 * this is purely a visual aid placed next to the apply / register CTA.
 */
import { useState } from 'react';
import { CalendarCheck2, CalendarX2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AvailabilityCalendar } from './availability-calendar';
import { cn } from '@/lib/utils';

type CalLocale = 'en' | 'fr' | 'ar';
type FixedState = 'open' | 'full' | 'closed';

interface FixedDateCalendarProps {
  /** ISO date (date-only or full ISO) marking the start / single date. */
  date: string;
  /** Optional ISO end date for multi-day items (e.g. program cohorts). */
  endDate?: string | null;
  state: FixedState;
  locale?: CalLocale;
  className?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Midnight-UTC milliseconds for a YYYY-MM-DD date. */
function toUTCms(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** Inclusive list of ISO days from `start` to `end` (capped to a year). */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const endMs = toUTCms(end);
  let ms = toUTCms(start);
  let guard = 0;
  while (ms <= endMs && guard < 366) {
    const d = new Date(ms);
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
    ms += 86_400_000;
    guard++;
  }
  return out.length ? out : [start];
}

export function FixedDateCalendar({
  date,
  endDate = null,
  state,
  locale = 'en',
  className,
}: FixedDateCalendarProps) {
  const t = useTranslations('common.fixedDate');
  const start = dateOnly(date);
  const end = endDate ? dateOnly(endDate) : start;
  const [month, setMonth] = useState<string>(start.slice(0, 7));

  const days = end > start ? daysBetween(start, end) : [start];
  const isOpen = state === 'open';
  // Let the month containing the date always be reachable, even when it's past.
  const minDate = start < todayISO() ? start : todayISO();

  const caption =
    state === 'full' ? t('fullyBooked') : state === 'closed' ? t('closed') : t('availableOn');

  return (
    <div className={cn('space-y-2', className)}>
      <AvailabilityCalendar
        month={month}
        onMonthChange={setMonth}
        availableDates={isOpen ? days : []}
        unavailableDates={isOpen ? [] : days}
        selectedDate={isOpen ? start : null}
        selectedRangeEnd={isOpen && end > start ? end : null}
        onSelectDate={() => {}}
        minDate={minDate}
        locale={locale}
      />
      <p
        className={cn(
          'flex items-center justify-center gap-1.5 text-xs font-medium',
          isOpen ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {isOpen ? <CalendarCheck2 className="size-3.5" /> : <CalendarX2 className="size-3.5" />}
        {caption}
      </p>
    </div>
  );
}
