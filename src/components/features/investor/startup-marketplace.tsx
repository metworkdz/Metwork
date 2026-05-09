'use client';

/**
 * Investor marketplace: filterable grid of active startup listings.
 * Wired to real StartupListing data from the DB.
 * Allows saving/un-saving per listing.
 */
import { useMemo, useState, useTransition } from 'react';
import { useLocale } from 'next-intl';
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

export function StartupMarketplace({ startups, savedIds: initialSavedIds }: Props) {
  const locale = useLocale() as Locale;
  const [query,    setQuery]    = useState('');
  const [industry, setIndustry] = useState(ALL);
  const [saved,    setSaved]    = useState<Set<string>>(new Set(initialSavedIds));
  const [, startTransition]     = useTransition();

  const industries = useMemo(() => {
    const set = new Set(startups.map((s) => s.industry));
    return Array.from(set).sort();
  }, [startups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return startups.filter((s) => {
      if (industry !== ALL && s.industry !== industry) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.industry.toLowerCase().includes(q)
      );
    });
  }, [startups, query, industry]);

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
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search startups, descriptions, industry…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
          />
        </div>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All industries</SelectItem>
            {industries.map((i) => (
              <SelectItem key={i} value={i}>{i}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {startups.length} listing{startups.length !== 1 ? 's' : ''}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title="No startups match your filters"
            description="Try clearing the search or selecting a different industry."
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
  return (
    <Card className="group flex flex-col transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
      <CardContent className="flex-1 p-6">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="default" className="text-xs">{startup.industry}</Badge>
          <button
            type="button"
            onClick={() => onToggleSave(startup.id)}
            aria-label={isSaved ? 'Remove from saved' : 'Save startup'}
            className="shrink-0 text-muted-foreground transition-colors hover:text-primary-600"
          >
            {isSaved
              ? <BookmarkCheck className="size-4 text-primary-600" />
              : <Bookmark className="size-4" />}
          </button>
        </div>

        <h3 className="mt-3 line-clamp-1 text-base font-semibold">{startup.name}</h3>
        <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground leading-relaxed">
          {startup.description}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Funding goal</p>
            <p className="mt-0.5 font-semibold tabular-nums">{formatDZD(startup.fundingGoal, locale)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Equity offered</p>
            <p className="mt-0.5 font-semibold">{startup.equityOffered}%</p>
          </div>
          {startup.valuation && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Pre-money valuation</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatDZD(startup.valuation, locale)}</p>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="border-t border-border/60 px-6 py-4">
        <Button asChild size="sm" className="w-full">
          <Link href={`/dashboard/investor/startups/${startup.id}`}>
            View details
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
