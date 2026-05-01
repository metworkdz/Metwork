/**
 * Program card. FI.co-style: prominent type label, cohort dates strip,
 * deadline countdown chip, and a strong "Apply" affordance.
 */
import { ArrowRight, CalendarRange, MapPin, Users } from 'lucide-react';
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

function deadlineChip(deadline: string) {
  const days = daysUntil(deadline);
  if (days < 0) return { label: 'Closed', variant: 'default' as const };
  if (days === 0) return { label: 'Closes today', variant: 'danger' as const };
  if (days <= 3) return { label: `Closes in ${days}d`, variant: 'danger' as const };
  if (days <= 7) return { label: `Closes in ${days}d`, variant: 'warning' as const };
  return { label: `Closes in ${days}d`, variant: 'outline' as const };
}

export function ProgramCard({ program, taken, locale, onSelect, featured }: ProgramCardProps) {
  const occupied = taken ?? program.seatsTaken;
  const remaining = Math.max(0, program.seatsTotal - occupied);
  const fillPct = Math.min(100, Math.round((occupied / program.seatsTotal) * 100));
  const dl = deadlineChip(program.deadline);
  const closed = daysUntil(program.deadline) < 0 || remaining === 0;

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
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" />
            {program.city} · {program.incubatorName}
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
              {occupied}/{program.seatsTotal} enrolled
            </span>
            {remaining > 0 ? (
              <span className="font-medium text-foreground">{remaining} seats left</span>
            ) : (
              <span className="font-medium text-destructive">Full</span>
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
            <p className="text-xs text-muted-foreground">Application fee</p>
            <p className="text-lg font-semibold tabular-nums">
              {program.price === 0 ? (
                <span className="text-emerald-700">Free</span>
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
            {closed ? 'View details' : 'Apply now'}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </span>
        </div>
      </div>
    </Card>
  );
}
