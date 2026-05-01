/**
 * Event card. Calendar-style date block on the start, content on the end.
 */
import { ArrowRight, MapPin, Users, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EventDateBlock } from './event-date-block';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Event as PlatformEvent } from '@/types/domain';

interface EventCardProps {
  event: PlatformEvent;
  taken: number | null;
  locale: Locale;
  onSelect: (event: PlatformEvent) => void;
}

export function EventCard({ event, taken, locale, onSelect }: EventCardProps) {
  const occupied = taken ?? event.attendeeCount;
  const remaining = Math.max(0, event.capacity - occupied);
  const fillPct = Math.min(100, Math.round((occupied / event.capacity) * 100));
  const passed = Date.parse(event.eventDate) <= Date.now();
  const full = remaining === 0;
  const closed = passed || full;

  return (
    <Card
      role="article"
      tabIndex={0}
      onClick={() => onSelect(event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(event);
        }
      }}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden p-0 transition-all sm:flex-row',
        'hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <EventDateBlock
        iso={event.eventDate}
        locale={locale}
        className="aspect-[16/10] w-full sm:aspect-auto sm:w-44 sm:shrink-0"
      />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" />
            {event.city} · {event.incubatorName}
          </p>
          {event.isOnline ? (
            <Badge variant="info" className="gap-1">
              <Wifi className="size-3" />
              Online
            </Badge>
          ) : (
            <Badge variant="outline">In person</Badge>
          )}
        </div>

        <h3 className="mt-2 line-clamp-1 text-lg font-semibold tracking-tight text-foreground">
          {event.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {event.description}
        </p>

        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {occupied}/{event.capacity}
          </span>
          <span aria-hidden>·</span>
          {full ? (
            <span className="font-medium text-destructive">Full</span>
          ) : passed ? (
            <span className="font-medium">Past event</span>
          ) : (
            <span className="font-medium text-foreground">{remaining} seats left</span>
          )}
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full',
              fillPct >= 90 ? 'bg-red-500' : fillPct >= 70 ? 'bg-amber-500' : 'bg-primary-500',
            )}
            style={{ width: `${fillPct}%` }}
          />
        </div>

        <div className="mt-4 flex items-end justify-between">
          <p className="text-base font-semibold tabular-nums">
            {event.price === 0 ? (
              <span className="text-emerald-700">Free</span>
            ) : (
              formatCurrency(event.price, locale)
            )}
          </p>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-sm font-semibold',
              closed ? 'text-muted-foreground' : 'text-primary-700 group-hover:underline',
            )}
          >
            {closed ? 'View details' : 'Register'}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </span>
        </div>
      </div>
    </Card>
  );
}
