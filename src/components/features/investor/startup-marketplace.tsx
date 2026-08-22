'use client';

/**
 * Investor marketplace: filterable grid of active startup listings.
 * Wired to real StartupListing data from the DB.
 * Allows saving/un-saving per listing.
 */
import { useMemo, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bookmark, BookmarkCheck, Search } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { StartupLogo } from '@/components/shared/startup-logo';
import { formatCurrency } from '@/lib/format';
import type { StartupListing } from '@/types/startup';
import type { Locale } from '@/i18n/config';

function formatDZD(amount: number, locale: Locale) {
  return formatCurrency(amount, locale);
}

interface Props {
  startups:   StartupListing[];
  savedIds:   Set<string>;
}

const ALL = 'all';

/**
 * Funding-range buckets. We use coarse buckets rather than two number inputs
 * because investors browse by rough size, not exact figures. Bucket boundaries
 * chosen for Algerian SME funding norms (in DZD).
 */
type FundingBucket = 'all' | 'lt500k' | '500k-2m' | '2m-10m' | 'gt10m';

const FUNDING_BUCKETS: Array<{ value: FundingBucket; label: string; min: number; max: number }> = [
  { value: 'all',      label: 'Any',                min: 0,           max: Infinity },
  { value: 'lt500k',   label: '< 500K',             min: 0,           max: 500_000 },
  { value: '500k-2m',  label: '500K – 2M',          min: 500_000,     max: 2_000_000 },
  { value: '2m-10m',   label: '2M – 10M',           min: 2_000_000,   max: 10_000_000 },
  { value: 'gt10m',    label: '> 10M',              min: 10_000_000,  max: Infinity },
];

type SortKey = 'newest' | 'fundingDesc' | 'fundingAsc' | 'equityAsc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'newest',      label: 'Newest first' },
  { value: 'fundingDesc', label: 'Funding: high → low' },
  { value: 'fundingAsc',  label: 'Funding: low → high' },
  { value: 'equityAsc',   label: 'Equity: low → high' },
];

export function StartupMarketplace({ startups, savedIds: initialSavedIds }: Props) {
  const locale = useLocale() as Locale;
  const t = useTranslations('investor.startups');
  const [query,    setQuery]    = useState('');
  const [industry, setIndustry] = useState(ALL);
  const [bucket,   setBucket]   = useState<FundingBucket>('all');
  const [sort,     setSort]     = useState<SortKey>('newest');
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved,    setSaved]    = useState<Set<string>>(new Set(initialSavedIds));
  const [, startTransition]     = useTransition();

  const industries = useMemo(() => {
    const set = new Set(startups.map((s) => s.industry));
    return Array.from(set).sort();
  }, [startups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const bk = FUNDING_BUCKETS.find((b) => b.value === bucket)!;

    const matches = startups.filter((s) => {
      if (industry !== ALL && s.industry !== industry) return false;
      if (savedOnly && !saved.has(s.id)) return false;
      if (s.fundingGoal < bk.min || s.fundingGoal > bk.max) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.industry.toLowerCase().includes(q)
      );
    });

    // Sort a copy so the source array stays untouched.
    const sorted = [...matches];
    switch (sort) {
      case 'newest':
        sorted.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        break;
      case 'fundingDesc':
        sorted.sort((a, b) => b.fundingGoal - a.fundingGoal);
        break;
      case 'fundingAsc':
        sorted.sort((a, b) => a.fundingGoal - b.fundingGoal);
        break;
      case 'equityAsc':
        sorted.sort((a, b) => a.equityOffered - b.equityOffered);
        break;
    }
    return sorted;
  }, [startups, query, industry, bucket, sort, savedOnly, saved]);

  const hasActiveFilter =
    query.trim() !== '' || industry !== ALL || bucket !== 'all' || savedOnly;

  function resetFilters() {
    setQuery('');
    setIndustry(ALL);
    setBucket('all');
    setSavedOnly(false);
    setSort('newest');
  }

  function toggleSave(id: string) {
    startTransition(async () => {
      setSaved((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      await fetch(`/api/startups/${id}/save`, {
        method: 'POST',
        credentials: 'include',
      });
    });
  }

  return (
    <div className="space-y-5">
      {/* Row 1: search + industry */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
          />
        </div>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder={t('industryPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allIndustries')}</SelectItem>
            {industries.map((i) => (
              <SelectItem key={i} value={i}>{i}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 2: funding bucket + sort + saved-only toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={bucket} onValueChange={(v) => setBucket(v as FundingBucket)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Funding goal" />
          </SelectTrigger>
          <SelectContent>
            {FUNDING_BUCKETS.map((b) => (
              <SelectItem key={b.value} value={b.value}>
                Funding: {b.label}{b.value !== 'all' ? ' DZD' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Saved-only chip — toggleable */}
        <Button
          type="button"
          size="sm"
          variant={savedOnly ? 'default' : 'outline'}
          onClick={() => setSavedOnly((v) => !v)}
          className="gap-1.5"
        >
          {savedOnly
            ? <BookmarkCheck className="size-3.5" />
            : <Bookmark className="size-3.5" />}
          Saved only
        </Button>

        {hasActiveFilter && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={resetFilters}
            className="ms-auto text-muted-foreground"
          >
            Clear filters
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {startups.length !== 1
          ? t('listingsCountPlural', { filtered: filtered.length, total: startups.length })
          : t('listingsCount', { filtered: filtered.length, total: startups.length })}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title={t('noMatch')}
            description={t('noMatchHint')}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <StartupCard
              key={s.id}
              startup={s}
              locale={locale}
              isSaved={saved.has(s.id)}
              onToggleSave={toggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Card ─────────────────────────── */

function StartupCard({
  startup,
  locale,
  isSaved,
  onToggleSave,
}: {
  startup:      StartupListing;
  locale:       Locale;
  isSaved:      boolean;
  onToggleSave: (id: string) => void;
}) {
  const t = useTranslations('investor.startups');

  return (
    <Card className="group flex flex-col transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
      <CardContent className="flex-1 p-6">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="default" className="text-xs">{startup.industry}</Badge>
          <button
            type="button"
            onClick={() => onToggleSave(startup.id)}
            aria-label={isSaved ? t('removeFromSaved') : t('saveStartup')}
            className="shrink-0 text-muted-foreground transition-colors hover:text-primary-600"
          >
            {isSaved
              ? <BookmarkCheck className="size-4 text-primary-600" />
              : <Bookmark className="size-4" />}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <StartupLogo logoUrl={startup.logoUrl} name={startup.name} size={40} />
          <h3 className="line-clamp-1 text-base font-semibold">{startup.name}</h3>
        </div>
        <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground leading-relaxed">
          {startup.description}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('fundingGoal')}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{formatDZD(startup.fundingGoal, locale)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('equityOffered')}</p>
            <p className="mt-0.5 font-semibold">{startup.equityOffered}%</p>
          </div>
          {startup.valuation && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">{t('preMoneyValuation')}</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatDZD(startup.valuation, locale)}</p>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="border-t border-border/60 px-6 py-4">
        <Button asChild size="sm" className="w-full">
          <Link href={`/dashboard/investor/startups/${startup.id}`}>
            {t('viewDetails')}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
