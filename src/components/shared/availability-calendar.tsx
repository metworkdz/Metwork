'use client';

/**
 * AvailabilityCalendar — a controlled, presentational month-grid calendar in
 * the Airbnb style. It owns NO business logic: the parent decides which dates
 * are available / booked / blocked / selected and reacts to navigation +
 * selection.
 *
 * Two interaction models, picked by the props the parent passes:
 *
 *   • SINGLE-SELECT (default) — `onSelectDate` + `selectedDate` (+ optional
 *     `selectedRangeEnd`). Tap one day. Used by the booking picker, the mentor
 *     scheduler, the fixed-date marker, and the legacy block editors. UNCHANGED.
 *
 *   • MULTI-SELECT — pass `onSelectionChange` (and `selectedDates`). Tap toggles
 *     a day in/out of the selection; PRESS-AND-DRAG paints a contiguous range
 *     (pointer events → mouse-drag and touch-swipe both work; the grid sets
 *     `touch-action:none` while dragging so the page doesn't scroll). Used by the
 *     space owner's block editor.
 *
 * Localization: month and weekday names come from `Intl.DateTimeFormat`. Arabic
 * renders fully RTL (the grid mirrors, weekday order flips, the prev/next arrows
 * swap, and the drag range is computed by date so its direction stays correct).
 *
 * Accessibility: arrow keys move focus across days (logical direction in RTL),
 * Enter / Space selects/toggles, and every cell carries an aria-label.
 *
 * Design: selected = brand green (`bg-primary`) with white text; booked = muted
 * with a small indicator; blocked = a neutral diagonal hatch; available days get
 * a subtle green dot. Surfaces use design-system tokens for light/dark dialogs.
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
  /** ISO yyyy-mm-dd dates rendered as unavailable / blocked (legacy single bucket). */
  unavailableDates?: string[];
  /** ISO yyyy-mm-dd dates taken by bookings — muted with an indicator (visual only). */
  bookedDates?: string[];
  /** ISO yyyy-mm-dd dates owner-blocked — neutral hatch (visual only). */
  blockedDates?: string[];
  selectedDate?: string | null;
  /**
   * Optional range end (ISO). When set together with `selectedDate`, days
   * strictly between the two are tinted and the end day gets the brand fill —
   * used by the space scheduler's multi-day (DAY/MONTH) picker. Default off,
   * so single-date consumers (mentors) are unaffected.
   */
  selectedRangeEnd?: string | null;
  onSelectDate: (date: string) => void;
  /**
   * MULTI-SELECT opt-in. When provided, `selectedDates` is the controlled
   * selection set and tap/drag report the next set through this callback;
   * `onSelectDate` / `selectedDate` are then ignored.
   */
  selectedDates?: string[];
  onSelectionChange?: (dates: string[]) => void;
  /** Show the Available / Booked / Blocked / Selected legend under the grid. */
  showLegend?: boolean;
  /** Earliest selectable date (ISO). Defaults to today. Past dates are always disabled. */
  minDate?: string;
  locale?: CalLocale;
  /**
   * 'select' (default): only `availableDates` are clickable.
   * 'block': every non-past day is clickable — used by the blocked-dates editors.
   * `unavailableDates` then means "currently blocked".
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

/** Inclusive list of ISO days between two dates, in ascending order. */
function datesInRange(a: string, b: string): string[] {
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  const out: string[] = [];
  let cur = lo;
  let guard = 0;
  while (cur <= hi && guard < 400) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
    guard++;
  }
  return out;
}

/** Diagonal-hatch fill for owner-blocked days (neutral, theme-aware). */
const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.18) 0, hsl(var(--muted-foreground) / 0.18) 1px, transparent 1px, transparent 5px)',
};

export function AvailabilityCalendar({
  month,
  onMonthChange,
  availableDates = [],
  unavailableDates = [],
  bookedDates = [],
  blockedDates = [],
  selectedDate = null,
  selectedRangeEnd = null,
  onSelectDate,
  selectedDates,
  onSelectionChange,
  showLegend = false,
  minDate,
  locale = 'en',
  mode = 'select',
  className,
}: AvailabilityCalendarProps) {
  const t = useTranslations('common.calendar');
  const tag = LOCALE_TAG[locale];
  const isRtl = locale === 'ar';
  const floor = minDate ?? todayISO();
  const multiSelect = typeof onSelectionChange === 'function';

  const { y, mon } = parseMonth(month);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const unavailableSet = useMemo(() => new Set(unavailableDates), [unavailableDates]);
  const bookedSet = useMemo(() => new Set(bookedDates), [bookedDates]);
  const blockedSet = useMemo(() => new Set(blockedDates), [blockedDates]);
  const selectionSet = useMemo(() => new Set(selectedDates ?? []), [selectedDates]);

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

  // Pointer drag (multi-select only).
  const [drag, setDrag] = useState<{ anchor: string; current: string; adding: boolean } | null>(null);

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

  /* ── Selection (single vs multi) ── */
  function emitSelection(next: Set<string>) {
    onSelectionChange?.([...next].sort());
  }
  function toggleOne(iso: string) {
    const next = new Set(selectionSet);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    emitSelection(next);
  }
  function selectIfPossible(iso: string) {
    if (!isSelectable(iso)) return;
    if (multiSelect) toggleOne(iso);
    else onSelectDate(iso);
  }

  // The selection to render: committed set with the in-flight drag range applied.
  const previewSet = useMemo(() => {
    if (!drag) return selectionSet;
    const next = new Set(selectionSet);
    for (const d of datesInRange(drag.anchor, drag.current)) {
      if (d < floor) continue;
      if (drag.adding) next.add(d);
      else next.delete(d);
    }
    return next;
  }, [drag, selectionSet, floor]);

  // Commit the in-flight drag. Held in a ref so the window pointerup listener
  // (attached while dragging) always sees the latest selection.
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
    if (!drag) return;
    const next = new Set(selectionSet);
    for (const d of datesInRange(drag.anchor, drag.current)) {
      if (d < floor) continue;
      if (drag.adding) next.add(d);
      else next.delete(d);
    }
    emitSelection(next);
    setDrag(null);
  };

  useEffect(() => {
    if (!drag) return;
    const finish = () => commitRef.current();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [drag]);

  function onCellPointerDown(iso: string, e: React.PointerEvent<HTMLButtonElement>) {
    if (!multiSelect || !isSelectable(iso)) return;
    e.preventDefault();
    // Drop the implicit touch capture so pointermove tracks across sibling cells.
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({ anchor: iso, current: iso, adding: !selectionSet.has(iso) });
  }

  function onGridPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const iso = el?.closest<HTMLElement>('[data-date]')?.dataset.date;
    if (iso && iso !== drag.current) setDrag((d) => (d ? { ...d, current: iso } : d));
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
        onPointerMove={multiSelect ? onGridPointerMove : undefined}
        className="grid grid-cols-7 gap-1"
        style={drag ? { touchAction: 'none' } : undefined}
      >
        {cells.map((day, idx) => {
          if (day === null) return <div key={`pad-${idx}`} aria-hidden="true" />;
          const iso = isoOf(y, mon, day);
          const isPast = iso < floor;
          const isUnavailable = unavailableSet.has(iso);
          const isAvailable = availableSet.has(iso);
          const isBooked = bookedSet.has(iso);
          const isBlocked = blockedSet.has(iso);
          const isRangeEnd = selectedRangeEnd != null && selectedRangeEnd === iso;
          const isSelected = multiSelect
            ? previewSet.has(iso)
            : selectedDate === iso || isRangeEnd;
          const isInRange =
            !multiSelect &&
            selectedDate != null &&
            selectedRangeEnd != null &&
            iso > selectedDate &&
            iso < selectedRangeEnd;
          const selectable = isSelectable(iso);
          const isFocusTarget = iso === focusedDate;

          // Compose an accessible label: date + state.
          const stateText = isSelected
            ? t('selected')
            : isBlocked
              ? t('legendBlocked')
              : isBooked
                ? t('legendBooked')
                : isUnavailable || (mode === 'select' && !isAvailable && !isPast)
                  ? t('unavailable')
                  : selectable
                    ? t('available')
                    : '';
          const ariaLabel = `${dayLabelFmt.format(new Date(Date.UTC(y, mon - 1, day)))}${
            stateText ? ` — ${stateText}` : ''
          }`;

          // Blocked/booked are visual overlays only when the day isn't selected.
          const showBlocked = !isSelected && isBlocked;
          const showBooked = !isSelected && !isBlocked && isBooked;

          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-date={iso}
              ref={(el) => {
                if (el) cellRefs.current.set(iso, el);
                else cellRefs.current.delete(iso);
              }}
              tabIndex={isFocusTarget ? 0 : -1}
              aria-label={ariaLabel}
              aria-selected={isSelected}
              aria-disabled={!selectable}
              disabled={!selectable && mode === 'select'}
              onPointerDown={multiSelect ? (e) => onCellPointerDown(iso, e) : undefined}
              onClick={multiSelect ? undefined : () => selectIfPossible(iso)}
              onFocus={() => setFocusedDate(iso)}
              style={showBlocked ? HATCH_STYLE : undefined}
              className={cn(
                'relative flex aspect-square min-h-11 items-center justify-center rounded-xl text-sm font-medium tabular-nums transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                // Selected — brand green.
                isSelected && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary',
                // In-range (between start and end) — subtle brand tint.
                !isSelected && isInRange && 'bg-primary/15 text-foreground hover:bg-primary/25',
                // Owner-blocked — neutral hatch (clickable in block mode).
                showBlocked && 'bg-muted/40 text-muted-foreground',
                showBlocked && mode === 'select' && 'cursor-not-allowed',
                // Booked — muted with an indicator.
                showBooked && 'bg-muted text-muted-foreground',
                showBooked && mode === 'select' && 'cursor-not-allowed',
                // Legacy single unavailable bucket (mentor/consultant block editors).
                !isSelected &&
                  mode === 'block' &&
                  isUnavailable &&
                  !isBlocked &&
                  'bg-destructive/10 text-destructive line-through hover:bg-destructive/20',
                // Available, not selected, no overlay.
                !isSelected &&
                  selectable &&
                  !showBlocked &&
                  !showBooked &&
                  !(mode === 'block' && isUnavailable) &&
                  'hover:bg-accent hover:text-accent-foreground',
                // Unavailable (select mode) / past — muted & struck.
                !isSelected &&
                  !isInRange &&
                  !selectable &&
                  !showBlocked &&
                  !showBooked &&
                  'cursor-not-allowed text-muted-foreground/40',
                !isSelected &&
                  !isInRange &&
                  !selectable &&
                  !showBlocked &&
                  !showBooked &&
                  (isUnavailable || (mode === 'select' && !isPast)) &&
                  'line-through',
              )}
            >
              {day}
              {/* Availability dot — select mode, non-selected available days. */}
              {mode === 'select' && isAvailable && !isSelected && selectable && !showBooked && !showBlocked && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary"
                />
              )}
              {/* Booked indicator — muted dot. */}
              {showBooked && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-muted-foreground/60"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="relative size-3 rounded-sm border border-border/60 bg-card">
              <span className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary" />
            </span>
            {t('legendAvailable')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-muted" />
            {t('legendBooked')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-border/60 bg-muted/40" style={HATCH_STYLE} />
            {t('legendBlocked')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-primary" />
            {t('legendSelected')}
          </span>
        </div>
      )}
    </div>
  );
}
