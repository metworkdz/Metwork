'use client';

/**
 * TimeSlotPicker — selectable pills for a single chosen day. Presentational
 * and controlled: the parent supplies the slots and reacts to selection.
 * Unavailable slots are disabled. Shares the calendar's design language
 * (brand-green selection, RTL-aware) and is fully keyboard accessible via
 * native button focus order.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DaySlot } from '@/types/mentor';

type SlotLocale = 'en' | 'fr' | 'ar';

export interface TimeSlotPickerProps {
  slots: DaySlot[];
  /** The currently selected slot start ("HH:MM"), or null. */
  selected?: string | null;
  onSelect: (slot: DaySlot) => void;
  locale?: SlotLocale;
  className?: string;
}

export function TimeSlotPicker({
  slots,
  selected = null,
  onSelect,
  locale = 'en',
  className,
}: TimeSlotPickerProps) {
  const t = useTranslations('common.timeSlots');
  const isRtl = locale === 'ar';

  if (slots.length === 0) {
    return (
      <p
        dir={isRtl ? 'rtl' : 'ltr'}
        className={cn('rounded-xl border border-border/60 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground', className)}
      >
        {t('noSlots')}
      </p>
    );
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      role="group"
      aria-label={t('selectTime')}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {slots.map((slot) => {
        const isSelected = slot.available && selected === slot.start;
        const label = `${slot.start} – ${slot.end}`;
        return (
          <button
            key={`${slot.start}-${slot.end}`}
            type="button"
            disabled={!slot.available}
            aria-pressed={isSelected}
            aria-label={`${label} — ${slot.available ? t('available') : t('unavailable')}`}
            onClick={() => slot.available && onSelect(slot)}
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
            <span dir="ltr">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
