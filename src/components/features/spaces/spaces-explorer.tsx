'use client';

/**
 * Public spaces explorer. Holds:
 *   - the city / category / search / sort filters
 *   - the result grid
 *   - the detail sheet (with the inline booking form)
 *
 * Filters live in component state. They map cleanly to query params on
 * `GET /api/spaces` once the listings backend ships.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { SpaceCard } from './space-card';
import { SpaceDetailSheet } from './space-detail-sheet';
import { categoryLabel, categoryOrder } from './space-meta';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Space, SpaceCategory } from '@/types/domain';

type SortKey = 'recommended' | 'priceAsc' | 'priceDesc' | 'rating';
const ALL = 'all';

interface SpacesExplorerProps {
  spaces: Space[];
  /** Distinct city codes pulled from the server side; pre-sorted by relevance. */
  cities: { code: string; name: string }[];
}

function priceFloor(s: Space): number {
  // Smallest unit price for sorting — the "from" price displayed on cards.
  return Math.min(
    ...[s.pricePerHour, s.pricePerDay, s.pricePerMonth].filter(
      (v): v is number => v != null,
    ),
    Number.POSITIVE_INFINITY,
  );
}

export function SpacesExplorer({ spaces, cities }: SpacesExplorerProps) {
  const locale = useLocale() as Locale;
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<string>(ALL);
  const [category, setCategory] = useState<SpaceCategory | typeof ALL>(ALL);
  const [sort, setSort] = useState<SortKey>('recommended');
  const [selected, setSelected] = useState<Space | null>(null);

  const counts = useMemo(() => {
    const c: Record<SpaceCategory | 'ALL', number> = {
      ALL: spaces.length,
      COWORKING: 0,
      PRIVATE_OFFICE: 0,
      TRAINING_ROOM: 0,
      DOMICILIATION: 0,
    };
    for (const s of spaces) c[s.category] += 1;
    return c;
  }, [spaces]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = spaces.filter((s) => {
      if (category !== ALL && s.category !== category) return false;
      if (city !== ALL && s.city.toLowerCase() !== city.toLowerCase()) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.incubatorName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.amenities.some((a) => a.toLowerCase().includes(q))
      );
    });
    if (sort === 'priceAsc') arr = [...arr].sort((a, b) => priceFloor(a) - priceFloor(b));
    if (sort === 'priceDesc') arr = [...arr].sort((a, b) => priceFloor(b) - priceFloor(a));
    if (sort === 'rating')
      arr = [...arr].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return arr;
  }, [spaces, query, city, category, sort]);

  return (
    <div className="space-y-6">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        <CategoryPill
          active={category === ALL}
          label={`All spaces`}
          count={counts.ALL}
          onClick={() => setCategory(ALL)}
        />
        {categoryOrder.map((c) => (
          <CategoryPill
            key={c}
            active={category === c}
            label={categoryLabel[c]}
            count={counts[c]}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      {/* Search + city + sort */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search spaces, amenities, hosts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label="Search spaces"
          />
        </div>
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="w-full md:w-[180px]">
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
          <SelectTrigger className="w-full md:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recommended">Recommended</SelectItem>
            <SelectItem value="priceAsc">Price: low → high</SelectItem>
            <SelectItem value="priceDesc">Price: high → low</SelectItem>
            <SelectItem value="rating">Top rated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {spaces.length} space{spaces.length === 1 ? '' : 's'}
        {city !== ALL && <> in <span className="font-medium text-foreground">{city}</span></>}
        {category !== ALL && <> · {categoryLabel[category as SpaceCategory]}</>}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title="No spaces match your filters"
            description="Try a different city, switch category, or clear the search."
          />
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <SpaceCard key={s.id} space={s} locale={locale} onSelect={setSelected} />
          ))}
        </div>
      )}

      <SpaceDetailSheet
        space={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

/* ─────────────────────────── Category pill ─────────────────────────── */

function CategoryPill({
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
          ? 'border-primary-300 bg-primary-50 text-primary-700'
          : 'border-border bg-background text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
          active ? 'bg-primary-100 text-primary-700' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
