'use client';

/**
 * Spaces results explorer — compact filter strip + card grid.
 *
 * `category` and `city` are now *controlled* props owned by the parent
 * SpacesPageClient (so the hero and results stay in sync).
 * `query` and `sort` remain internal state — they are refinements that
 * users adjust after the initial hero search, not primary discovery filters.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  ArrowUpDown,
  Briefcase,
  Building2,
  GraduationCap,
  LayoutGrid,
  MapPinOff,
  RotateCcw,
  Search,
  Users2,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SpaceCard } from './space-card';
import { SpaceDetailSheet } from './space-detail-sheet';
import { categoryLabel, categoryOrder } from './space-meta';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Space, SpaceCategory } from '@/types/domain';

const ALL = 'all' as const;
type SortKey = 'recommended' | 'priceAsc' | 'priceDesc' | 'rating';

const CATEGORY_ICONS: Record<SpaceCategory | 'all', React.ComponentType<{ className?: string }>> = {
  all: LayoutGrid,
  COWORKING: Users2,
  PRIVATE_OFFICE: Briefcase,
  TRAINING_ROOM: GraduationCap,
  DOMICILIATION: Building2,
};

interface SpacesExplorerProps {
  spaces: Space[];
  cities: { code: string; name: string }[];
  /** Controlled from parent (hero) */
  category: SpaceCategory | 'all';
  city: string;
  onCategoryChange: (c: SpaceCategory | 'all') => void;
  onCityChange: (c: string) => void;
}

function priceFloor(s: Space): number {
  return Math.min(
    ...[s.pricePerHour, s.pricePerDay, s.pricePerMonth].filter(
      (v): v is number => v != null,
    ),
    Number.POSITIVE_INFINITY,
  );
}

export function SpacesExplorer({
  spaces,
  cities,
  category,
  city,
  onCategoryChange,
  onCityChange,
}: SpacesExplorerProps) {
  const locale = useLocale() as Locale;
  const [query, setQuery] = useState('');
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
    if (sort === 'priceAsc')  arr = [...arr].sort((a, b) => priceFloor(a) - priceFloor(b));
    if (sort === 'priceDesc') arr = [...arr].sort((a, b) => priceFloor(b) - priceFloor(a));
    if (sort === 'rating')    arr = [...arr].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return arr;
  }, [spaces, query, city, category, sort]);

  const hasActiveFilters = category !== ALL || city !== ALL || query.trim().length > 0;

  function resetFilters() {
    onCategoryChange(ALL);
    onCityChange(ALL);
    setQuery('');
    setSort('recommended');
  }

  return (
    <div className="space-y-6">

      {/* ── Section heading ── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Available workspaces
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {spaces.length} spaces across {cities.length} {cities.length === 1 ? 'city' : 'cities'}
          </p>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-primary"
          >
            <RotateCcw className="size-3" />
            Reset all filters
          </button>
        )}
      </div>

      {/* ── Category pills strip ── */}
      <div
        role="group"
        aria-label="Filter by category"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {/* All */}
        <CategoryPill
          icon={CATEGORY_ICONS.all}
          active={category === ALL}
          label="All"
          count={counts.ALL}
          onClick={() => onCategoryChange(ALL)}
        />
        {categoryOrder.map((c) => (
          <CategoryPill
            key={c}
            icon={CATEGORY_ICONS[c]}
            active={category === c}
            label={categoryLabel[c]}
            count={counts[c]}
            onClick={() => onCategoryChange(c)}
          />
        ))}
      </div>

      {/* ── Search + sort bar ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
        {/* Text search */}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            placeholder="Search spaces, amenities, hosts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-10 pe-9"
            aria-label="Search spaces"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* City filter */}
        <Select value={city} onValueChange={onCityChange}>
          <SelectTrigger className="w-full sm:w-[160px]" aria-label="Filter by city">
            <SelectValue placeholder="All cities" />
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

        {/* Sort */}
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-[190px]" aria-label="Sort spaces">
            <ArrowUpDown className="me-1.5 size-3.5 text-muted-foreground" />
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

      {/* ── Results count ── */}
      <p className="text-sm text-slate-500">
        <span className="font-semibold text-slate-800">{filtered.length}</span>
        {' '}of {spaces.length} space{spaces.length !== 1 ? 's' : ''}
        {city !== ALL && (
          <>
            {' '}in{' '}
            <span className="font-medium text-slate-800">{city}</span>
          </>
        )}
        {category !== ALL && (
          <>
            {' '}·{' '}
            <span className="font-medium text-slate-800">{categoryLabel[category as SpaceCategory]}</span>
          </>
        )}
      </p>

      {/* ── Results grid or empty state ── */}
      {filtered.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} onReset={resetFilters} />
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

/* ─────────────────────── Category pill ─────────────────────── */

function CategoryPill({
  icon: Icon,
  active,
  label,
  count,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
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
        'inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary/[0.07] text-primary shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800',
      )}
    >
      <Icon className="size-3.5" />
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
          active ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-500',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ─────────────────────── Empty state ─────────────────────── */

function EmptyState({
  hasFilters,
  onReset,
}: {
  hasFilters: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-8 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <MapPinOff className="size-7 text-slate-400" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-slate-800">
        {hasFilters ? 'No spaces match your search' : 'No spaces available yet'}
      </h3>
      <p className="mt-2 max-w-xs text-sm text-slate-500">
        {hasFilters
          ? 'Try adjusting your filters, choosing a different city, or clearing the search term.'
          : 'Spaces are coming soon. Check back later or contact us for enquiries.'}
      </p>
      {hasFilters && (
        <Button
          variant="outline"
          onClick={onReset}
          className="mt-6 gap-2 rounded-xl"
        >
          <RotateCcw className="size-3.5" />
          Show all spaces
        </Button>
      )}
    </div>
  );
}
