'use client';

/**
 * Programs explorer. FI.co-style filters: type pills with live counts,
 * city + status selects, search box, sort. The first filtered match
 * renders as a wider featured card.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { ProgramCard } from './program-card';
import { ProgramDetailSheet } from './program-detail-sheet';
import { programTypeLabel, programTypeOrder } from './program-meta';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Program, ProgramType } from '@/types/domain';

type SortKey = 'recommended' | 'deadlineAsc' | 'priceAsc' | 'startAsc';
type StatusFilter = 'all' | 'open' | 'closed';
const ALL = 'all';

interface ProgramsExplorerProps {
  programs: Program[];
  cities: { code: string; name: string }[];
  /** Live attendance counts keyed by program id. */
  attendance: Record<string, number>;
}

function isOpen(p: Program, taken: number): boolean {
  return Date.parse(p.deadline) > Date.now() && taken < p.seatsTotal;
}

export function ProgramsExplorer({ programs, cities, attendance }: ProgramsExplorerProps) {
  const t = useTranslations('programs.explorer');
  const locale = useLocale() as Locale;
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<string>(ALL);
  const [type, setType] = useState<ProgramType | typeof ALL>(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('recommended');
  const [selected, setSelected] = useState<Program | null>(null);

  const counts = useMemo(() => {
    const c: Record<ProgramType | 'ALL', number> = {
      ALL: programs.length,
      ACCELERATION: 0,
      INCUBATION: 0,
      BOOTCAMP: 0,
      TRAINING: 0,
      WORKSHOP: 0,
      WEBINAR: 0,
    };
    for (const p of programs) c[p.type] += 1;
    return c;
  }, [programs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = programs.filter((p) => {
      if (type !== ALL && p.type !== type) return false;
      if (city !== ALL && p.city.toLowerCase() !== city.toLowerCase()) return false;
      const taken = attendance[p.id] ?? p.seatsTaken;
      const open = isOpen(p, taken);
      if (statusFilter === 'open' && !open) return false;
      if (statusFilter === 'closed' && open) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.hostName.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });

    if (sort === 'deadlineAsc')
      arr = [...arr].sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
    if (sort === 'priceAsc') arr = [...arr].sort((a, b) => a.price - b.price);
    if (sort === 'startAsc')
      arr = [...arr].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));

    return arr;
  }, [programs, attendance, type, city, statusFilter, query, sort]);

  const featured = filtered[0] ?? null;
  const rest = featured ? filtered.slice(1) : [];

  return (
    <div className="space-y-6">
      {/* Type pills */}
      <div className="flex flex-wrap gap-2">
        <TypePill
          active={type === ALL}
          label={t('all')}
          count={counts.ALL}
          onClick={() => setType(ALL)}
        />
        {programTypeOrder.map((t) => (
          <TypePill
            key={t}
            active={type === t}
            label={programTypeLabel[t]}
            count={counts[t]}
            onClick={() => setType(t)}
          />
        ))}
      </div>

      {/* Search + city + status + sort */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label="Search programs"
          />
        </div>
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="w-full md:w-[170px]">
            <SelectValue placeholder={t('city')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allCities')}</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c.code} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatus')}</SelectItem>
            <SelectItem value="open">{t('openNow')}</SelectItem>
            <SelectItem value="closed">{t('closedStatus')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full col-span-2 md:col-span-1 md:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recommended">{t('sortRecommended')}</SelectItem>
            <SelectItem value="deadlineAsc">{t('sortClosingSoonest')}</SelectItem>
            <SelectItem value="startAsc">{t('sortStartingSoonest')}</SelectItem>
            <SelectItem value="priceAsc">{t('sortPriceLow')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} {t('of')} {programs.length} {programs.length === 1 ? t('program') : t('programs')}
        {city !== ALL && (
          <>
            {' '}{t('in')} <span className="font-medium text-foreground">{city}</span>
          </>
        )}
        {type !== ALL && <> · {programTypeLabel[type as ProgramType]}</>}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {featured && (
            <ProgramCard
              key={`featured-${featured.id}`}
              program={featured}
              taken={attendance[featured.id] ?? null}
              locale={locale}
              onSelect={setSelected}
              featured
            />
          )}
          {rest.length > 0 && (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {rest.map((p) => (
                <ProgramCard
                  key={p.id}
                  program={p}
                  taken={attendance[p.id] ?? null}
                  locale={locale}
                  onSelect={setSelected}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ProgramDetailSheet
        program={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function TypePill({
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
