'use client';

/**
 * Program card. FI.co-style: prominent type label, cohort dates strip,
 * deadline countdown chip, and a strong "Apply" affordance.
 */
import { useTranslations } from 'next-intl';
import { ArrowRight, CalendarRange, Images, MapPin, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgramImage } from './program-image';
import { programTypeLabel } from './program-meta';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Program } from '@/types/domain';

interface ProgramCardProps {
  program: Program;
  /** Live attendance for this program (bookings count). Falls back to `seatsTaken`. */
  taken: number | null;
  locale: Locale;
  onSelect: (program: Program) => void;
  /** When `true`, render a wider featured layout. */
  featured?: boolean;
}

function daysUntil(iso: string): number {
  const ms = Date.parse(iso) - Date.now();
  return Math.ceil(ms / (24 * 3600 * 1000));
}

export function ProgramCard({ program, taken, locale, onSelect, featured }: ProgramCardProps) {
  const t = useTranslations('programs.card');
  const tc = useTranslations('common');
  const photoCount = program.imageUrls?.length ?? 0;
  const occupied = taken ?? program.seatsTaken;
  const remaining = Math.max(0, program.seatsTotal - occupied);
  const fillPct = Math.min(100, Math.round((occupied / program.seatsTotal) * 100));
  const days = daysUntil(program.deadline);
  const dl = ((): { label: string; variant: 'default' | 'danger' | 'warning' | 'outline' } => {
    if (days < 0) return { label: t('closed'), variant: 'default' };
    if (days === 0) return { label: t('closesToday'), variant: 'danger' };
    if (days <= 3) return { label: t('closesIn', { count: days }), variant: 'danger' };
    if (days <= 7) return { label: t('closesIn', { count: days }), variant: 'warning' };
    return { label: t('closesIn', { count: days }), variant: 'outline' };
  })();
  const closed = days < 0 || remaining === 0;

  return (
    <Card
      role="article"
      tabIndex={0}
      onClick={() => onSelect(program)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(program);
        }
      }}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden p-0 transition-all',
        'hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        featured && 'lg:flex-row',
      )}
    >
      <div
        className={cn(
          'relative shrink-0',
          featured ? 'aspect-[16/10] w-full lg:aspect-auto lg:w-2/5' : 'aspect-[16/10] w-full',
        )}
      >
        <ProgramImage type={program.type} imageUrl={program.imageUrl} alt={program.title} />
        <div className="absolute start-3 top-3 inline-flex items-center gap-1 rounded-full bg-foreground/90 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-background">
          {programTypeLabel[program.type]}
        </div>
        {photoCount > 1 && (
          <div className="absolute end-3 bottom-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            <Images className="size-3" />
            {tc('photosCount', { count: photoCount })}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" />
            {program.city} · {program.hostName}
          </p>
          <Badge variant={dl.variant}>{dl.label}</Badge>
        </div>

        <h3
          className={cn(
            'mt-3 font-semibold tracking-tight text-foreground',
            featured ? 'text-2xl' : 'text-lg',
          )}
        >
          {program.title}
        </h3>
        <p className={cn('mt-2 text-sm text-muted-foreground', featured ? 'line-clamp-3' : 'line-clamp-2')}>
          {program.description}
        </p>

        {/* Cohort timeline strip */}
        <div className="mt-5 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          <CalendarRange className="size-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {formatDate(program.startDate, locale, { dateStyle: 'medium' })}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium text-foreground">
            {formatDate(program.endDate, locale, { dateStyle: 'medium' })}
          </span>
        </div>

        {/* Capacity bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              {t('enrolled', { count: occupied })}
            </span>
            {remaining > 0 ? (
              <span className="font-medium text-foreground">{t('seatsLeft', { count: remaining })}</span>
            ) : (
              <span className="font-medium text-destructive">{t('full')}</span>
            )}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full',
                fillPct >= 90 ? 'bg-red-500' : fillPct >= 70 ? 'bg-amber-500' : 'bg-primary-500',
              )}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between pt-1">
          <div>
            <p className="text-xs text-muted-foreground">{t('applicationFee')}</p>
            <p className="text-lg font-semibold tabular-nums">
              {program.price === 0 ? (
                <span className="text-emerald-700">{t('free')}</span>
              ) : (
                formatCurrency(program.price, locale)
              )}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-sm font-semibold',
              closed ? 'text-muted-foreground' : 'text-primary-700 group-hover:underline',
            )}
          >
            {closed ? t('viewDetails') : t('applyNow')}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </span>
        </div>
      </div>
    </Card>
  );
}
