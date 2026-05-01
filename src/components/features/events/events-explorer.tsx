'use client';

/**
 * Events explorer. Filters: mode (all/online/in-person), price (all/free/paid),
 * city, sort. Results group by month for a calendar feel.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { EventCard } from './event-card';
import { EventDetailSheet } from './event-detail-sheet';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Event as PlatformEvent } from '@/types/domain';

type SortKey = 'recommended' | 'soonest' | 'priceAsc';
type ModeFilter = 'all' | 'online' | 'in_person';
type PriceFilter = 'all' | 'free' | 'paid';
const ALL = 'all';

interface EventsExplorerProps {
  events: PlatformEvent[];
  cities: { code: string; name: string }[];
  attendance: Record<string, number>;
}

function localeFor(locale: Locale) {
  return locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-GB';
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function EventsExplorer({ events, cities, attendance }: EventsExplorerProps) {
  const locale = useLocale() as Locale;
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<string>(ALL);
  const [mode, setMode] = useState<ModeFilter>('all');
  const [price, setPrice] = useState<PriceFilter>('all');
  const [sort, setSort] = useState<SortKey>('soonest');
  const [selected, setSelected] = useState<PlatformEvent | null>(null);

  const counts = useMemo(() => {
    const free = events.filter((e) => e.price === 0).length;
    const online = events.filter((e) => e.isOnline).length;
    return { all: events.length, free, online };
  }, [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = events.filter((e) => {
      if (city !== ALL && e.city.toLowerCase() !== city.toLowerCase()) return false;
      if (mode === 'online' && !e.isOnline) return false;
      if (mode === 'in_person' && e.isOnline) return false;
      if (price === 'free' && e.price !== 0) return false;
      if (price === 'paid' && e.price === 0) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.incubatorName.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    });

    if (sort === 'soonest')
      arr = [...arr].sort((a, b) => Date.parse(a.eventDate) - Date.parse(b.eventDate));
    if (sort === 'priceAsc') arr = [...arr].sort((a, b) => a.price - b.price);

    return arr;
  }, [events, city, mode, price, query, sort]);

  // Group by month for the calendar feel.
  const groups = useMemo(() => {
    const map = new Map<string, PlatformEvent[]>();
    for (const e of filtered) {
      const key = monthKey(e.eventDate);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function monthLabel(key: string): string {
    const [yearStr = '', monthStr = ''] = key.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return key;
    const d = new Date(Date.UTC(year, month - 1, 1));
    return new Intl.DateTimeFormat(localeFor(locale), {
      month: 'long',
      year: 'numeric',
    }).format(d);
  }

  return (
    <div className="space-y-6">
      {/* Top filter bar */}
      <div className="flex flex-wrap gap-2">
        <ModePill active={mode === 'all'} label="All events" count={counts.all} onClick={() => setMode('all')} />
        <ModePill active={mode === 'in_person'} label="In person" count={counts.all - counts.online} onClick={() => setMode('in_person')} />
        <ModePill active={mode === 'online'} label="Online" count={counts.online} onClick={() => setMode('online')} />
        <span aria-hidden className="mx-1 hidden h-7 w-px bg-border sm:block" />
        <ModePill
          active={price === 'free'}
          label="Free only"
          count={counts.free}
          onClick={() => setPrice(price === 'free' ? 'all' : 'free')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search events, hosts, topics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label="Search events"
          />
        </div>
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="w-full md:w-[170px]">
            <SelectValue placeholder="City" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All cities</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c.code} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="soonest">Soonest first</SelectItem>
            <SelectItem value="priceAsc">Price: low → high</SelectItem>
            <SelectItem value="recommended">Recommended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {events.length} event{events.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title="No events match"
            description="Try widening the filters or clearing the search."
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map(([key, items]) => (
            <section key={key}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {monthLabel(key)}
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    taken={attendance[e.id] ?? null}
                    locale={locale}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <EventDetailSheet
        event={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function ModePill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
          active ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
