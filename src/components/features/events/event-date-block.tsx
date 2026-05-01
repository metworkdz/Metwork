/**
 * Calendar-style date block. Big day-of-month numeral on top,
 * abbreviated month underneath. Used as the "image" area for event cards.
 */
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

interface EventDateBlockProps {
  iso: string;
  locale: Locale;
  /** When true, render at a smaller size for use inside the detail sheet header. */
  compact?: boolean;
  /** Tailwind classes for the container — useful for sizing/aspect from the parent. */
  className?: string;
}

function localeFor(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-GB';
}

export function EventDateBlock({ iso, locale, compact, className }: EventDateBlockProps) {
  const d = new Date(iso);
  const month = new Intl.DateTimeFormat(localeFor(locale), { month: 'short' })
    .format(d)
    .toUpperCase();
  const day = new Intl.DateTimeFormat(localeFor(locale), { day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat(localeFor(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  const weekday = new Intl.DateTimeFormat(localeFor(locale), { weekday: 'short' }).format(d);

  return (
    <div
      className={cn(
        'relative isolate flex flex-col items-center justify-center overflow-hidden bg-foreground text-background',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_30%,_rgba(99,102,241,0.32),_transparent_50%),radial-gradient(circle_at_70%_70%,_rgba(34,197,94,0.22),_transparent_55%)]"
      />
      <p
        className={cn(
          'font-medium uppercase tracking-[0.18em] text-background/70',
          compact ? 'text-[10px]' : 'text-xs',
        )}
      >
        {month}
      </p>
      <p
        className={cn(
          'mt-1 font-semibold tabular-nums leading-none tracking-tight',
          compact ? 'text-3xl' : 'text-5xl sm:text-6xl',
        )}
      >
        {day}
      </p>
      <p
        className={cn(
          'mt-1 font-medium text-background/80',
          compact ? 'text-[10px]' : 'text-xs',
        )}
      >
        {weekday} · {time}
      </p>
    </div>
  );
}
