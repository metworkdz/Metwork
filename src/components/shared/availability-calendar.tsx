'use client';

/**
 * AvailabilityCalendar — a controlled, presentational month-grid calendar in
 * the Airbnb style. It owns NO business logic: the parent decides which dates
 * are available / unavailable / selected and reacts to navigation + selection.
 *
 * Localization: month and weekday names come from `Intl.DateTimeFormat`, so we
 * don't ship a translation table for every month. Arabic renders fully RTL
 * (the grid mirrors, weekday order flips, the prev/next arrows swap).
 *
 * Accessibility: arrow keys move focus across days (logical direction in RTL),
 * Enter / Space selects, and every cell carries an aria-label describing the
 * date and its state.
 *
 * Design: the selected day uses the brand green (`bg-primary` ≈ #2ECC71) with
 * white text; surfaces use the design-system tokens so the component is at home
 * in both light and dark dialogs. Available days get a subtle dot; unavailable
 * days are muted, struck through, and not selectable (except in `block` mode,
 * where every non-past day is clickable so an admin can toggle blocked dates).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type CalLocale = 'en' | 'fr' | 'ar';

export interface AvailabilityCalendarProps {
  /** Displayed month as "YYYY-MM". */
  month: string;
  onMonthChange: (month: string) => void;
  /** ISO yyyy-mm-dd dates that are selectable. */
  availableDates?: string[];
  /** ISO yyyy-mm-dd dates rendered as unavailable / blocked. */
  unavailableDates?: string[];
  selectedDate?: string | null;
  /**
   * Optional range end (ISO). When set together with `selectedDate`, days
   * strictly between the two are tinted and the end day gets the brand fill —
   * used by the space scheduler's multi-day (DAY/MONTH) picker. Default off,
   * so single-date consumers (mentors) are unaffected.
   */
  selectedRangeEnd?: string | null;
  onSelectDate: (date: string) => void;
  /** Earliest selectable date (ISO). Defaults to today. Past dates are always disabled. */
  minDate?: string;
  locale?: CalLocale;
  /**
   * 'select' (default): only `availableDates` are clickable.
   * 'block': every non-past day is clickable (toggle) — used by the admin
   * blocked-dates editor. `unavailableDates` then means "currently blocked".
   */
  mode?: 'select' | 'block';
  className?: string;
}

const LOCALE_TAG: Record<CalLocale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  ar: 'ar-DZ',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM" → { y, mon } (mon is 1-12). Falls back to the current month if malformed. */
function parseMonth(m: string): { y: number; mon: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) {
    const d = new Date();
    return { y: d.getFullYear(), mon: d.getMonth() + 1 };
  }
  return { y: Number(match[1]), mon: Number(match[2]) };
}

function isoOf(y: number, mon: number, day: number): string {
  return `${y}-${pad2(mon)}-${pad2(day)}`;
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function daysInMonth(y: number, mon: number): number {
  return new Date(Date.UTC(y, mon, 0)).getUTCDate();
}

/** Weekday of the 1st of the month, 0 = Sunday … 6 = Saturday. */
function firstWeekday(y: number, mon: number): number {
  return new Date(Date.UTC(y, mon - 1, 1)).getUTCDay();
}

/** Shift an ISO date by `delta` days (UTC-anchored for determinism). */
function addDaysISO(iso: string, delta: number): string {
  const [y, mon, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y!, mon! - 1, d!) + delta * 86_400_000;
  const nd = new Date(ms);
  return isoOf(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate());
}

export function AvailabilityCalendar({
  month,
  onMonthChange,
  availableDates = [],
  unavailableDates = [],
  selectedDate = null,
  selectedRangeEnd = null,
  onSelectDate,
  minDate,
  locale = 'en',
  mode = 'select',
  className,
}: AvailabilityCalendarProps) {
  const t = useTranslations('common.calendar');
  const tag = LOCALE_TAG[locale];
  const isRtl = locale === 'ar';
  const floor = minDate ?? todayISO();

  const { y, mon } = parseMonth(month);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const unavailableSet = useMemo(() => new Set(unavailableDates), [unavailableDates]);

  // Localized labels via Intl (no translation table needed).
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(
        new Date(Date.UTC(y, mon - 1, 1)),
      ),
    [tag, y, mon],
  );
  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(tag, { weekday: 'short' });
    // 2023-01-01 (UTC) is a Sunday — index 0..6 maps to Sun..Sat.
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(Date.UTC(2023, 0, 1 + i))),
    );
  }, [tag]);
  const dayLabelFmt = useMemo(
    () => new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    [tag],
  );

  // Roving-tabindex focus management.
  const [focusedDate, setFocusedDate] = useState<string>(() => isoOf(y, mon, 1));
  const wantFocusRef = useRef(false);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Keep the focused day inside the displayed month.
  useEffect(() => {
    if (monthOf(focusedDate) === month) return;
    const candidate =
      selectedDate && monthOf(selectedDate) === month ? selectedDate : isoOf(y, mon, 1);
    setFocusedDate(candidate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // After a keyboard move, pull DOM focus to the newly focused cell.
  useEffect(() => {
    if (!wantFocusRef.current) return;
    wantFocusRef.current = false;
    cellRefs.current.get(focusedDate)?.focus();
  }, [focusedDate]);

  function goToMonth(deltaMonths: number) {
    const base = new Date(Date.UTC(y, mon - 1 + deltaMonths, 1));
    onMonthChange(`${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}`);
  }

  const prevDisabled = month <= monthOf(floor);

  function isSelectable(iso: string): boolean {
    if (iso < floor) return false;
    if (mode === 'block') return true;
    return availableSet.has(iso) && !unavailableSet.has(iso);
  }

  function selectIfPossible(iso: string) {
    if (isSelectable(iso)) onSelectDate(iso);
  }

  function moveFocus(targetIso: string) {
    if (targetIso < floor) return; // never focus before the floor
    wantFocusRef.current = true;
    if (monthOf(targetIso) !== month) {
      onMonthChange(monthOf(targetIso));
    }
    setFocusedDate(targetIso);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const back = isRtl ? 1 : -1; // ArrowLeft is "previous" in LTR, "next" in RTL
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(addDaysISO(focusedDate, back));
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(addDaysISO(focusedDate, -back));
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(addDaysISO(focusedDate, -7));
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(addDaysISO(focusedDate, 7));
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(isoOf(y, mon, 1));
        break;
      case 'End':
        e.preventDefault();
        moveFocus(isoOf(y, mon, daysInMonth(y, mon)));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectIfPossible(focusedDate);
        break;
    }
  }

  const lead = firstWeekday(y, mon);
  const total = daysInMonth(y, mon);
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={cn(
        'w-full select-none rounded-2xl border border-border/60 bg-card p-4 text-card-foreground shadow-sm',
        className,
      )}
    >
      {/* Header: month label + prev/next */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => goToMonth(-1)}
          disabled={prevDisabled}
          aria-label={t('previousMonth')}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-full border border-border/60 transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <PrevIcon className="size-4" />
        </button>
        <div aria-live="polite" className="text-sm font-semibold capitalize">
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={() => goToMonth(1)}
          aria-label={t('nextMonth')}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-full border border-border/60 transition-colors',
            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <NextIcon className="size-4" />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 pb-1">
        {weekdayLabels.map((w, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="py-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="grid"
        aria-label={monthLabel}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-1"
      >
        {cells.map((day, idx) => {
          if (day === null) return <div key={`pad-${idx}`} aria-hidden="true" />;
          const iso = isoOf(y, mon, day);
          const isPast = iso < floor;
          const isUnavailable = unavailableSet.has(iso);
          const isAvailable = availableSet.has(iso);
          const isRangeEnd = selectedRangeEnd != null && selectedRangeEnd === iso;
          const isSelected = selectedDate === iso || isRangeEnd;
          const isInRange =
            selectedDate != null &&
            selectedRangeEnd != null &&
            iso > selectedDate &&
            iso < selectedRangeEnd;
          const selectable = isSelectable(iso);
          const isFocusTarget = iso === focusedDate;

          // Compose an accessible label: date + state.
          const stateText = isSelected
            ? t('selected')
            : isUnavailable || (mode === 'select' && !isAvailable && !isPast)
              ? t('unavailable')
              : selectable
                ? t('available')
                : '';
          const ariaLabel = `${dayLabelFmt.format(new Date(Date.UTC(y, mon - 1, day)))}${
            stateText ? ` — ${stateText}` : ''
          }`;

          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              ref={(el) => {
                if (el) cellRefs.current.set(iso, el);
                else cellRefs.current.delete(iso);
              }}
              tabIndex={isFocusTarget ? 0 : -1}
              aria-label={ariaLabel}
              aria-pressed={isSelected}
              aria-disabled={!selectable}
              disabled={!selectable && mode === 'select'}
              onClick={() => selectIfPossible(iso)}
              onFocus={() => setFocusedDate(iso)}
              className={cn(
                'relative flex aspect-square min-h-11 items-center justify-center rounded-xl text-sm font-medium tabular-nums transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                // Selected — brand green.
                isSelected && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary',
                // In-range (between start and end) — subtle brand tint.
                !isSelected && isInRange && 'bg-primary/15 text-foreground hover:bg-primary/25',
                // Blocked (block mode) — clickable but visibly struck.
                !isSelected &&
                  mode === 'block' &&
                  isUnavailable &&
                  'bg-destructive/10 text-destructive line-through hover:bg-destructive/20',
                // Available, not selected.
                !isSelected &&
                  selectable &&
                  !(mode === 'block' && isUnavailable) &&
                  'hover:bg-accent hover:text-accent-foreground',
                // Unavailable (select mode) / past — muted & struck.
                !isSelected &&
                  !isInRange &&
                  !selectable &&
                  'cursor-not-allowed text-muted-foreground/40',
                !isSelected && !isInRange && !selectable && (isUnavailable || (mode === 'select' && !isPast)) && 'line-through',
              )}
            >
              {day}
              {/* Availability dot — only in select mode for non-selected available days. */}
              {mode === 'select' && isAvailable && !isSelected && selectable && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
