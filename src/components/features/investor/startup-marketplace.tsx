'use client';

/**
 * Investor marketplace: filterable grid of listed startups. Stage / sector
 * filters are local state for now — they map cleanly to query params on
 * `GET /api/startups` once the listings API ships.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { Card } from '@/components/ui/card';
import { StartupCard } from './startup-card';
import type { Startup, StartupStage } from '@/types/domain';
import type { Locale } from '@/i18n/config';

interface StartupMarketplaceProps {
  startups: Startup[];
}

const ALL = 'all';

export function StartupMarketplace({ startups }: StartupMarketplaceProps) {
  const locale = useLocale() as Locale;
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<StartupStage | typeof ALL>(ALL);
  const [sector, setSector] = useState<string>(ALL);
  const [pendingMeetingId, setPendingMeetingId] = useState<string | null>(null);

  const sectors = useMemo(() => {
    const set = new Set(startups.map((s) => s.sector));
    return Array.from(set).sort();
  }, [startups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return startups.filter((s) => {
      if (stage !== ALL && s.stage !== stage) return false;
      if (sector !== ALL && s.sector !== sector) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.tagline.toLowerCase().includes(q) ||
        s.pitch.toLowerCase().includes(q) ||
        s.founderName.toLowerCase().includes(q)
      );
    });
  }, [startups, query, stage, sector]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search startups, founders, sectors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label="Search startups"
          />
        </div>
        <Select value={stage} onValueChange={(v) => setStage(v as StartupStage | typeof ALL)}>
          <SelectTrigger className="w-full md:w-[160px]">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All stages</SelectItem>
            <SelectItem value="IDEA">Idea</SelectItem>
            <SelectItem value="PRE_SEED">Pre-seed</SelectItem>
            <SelectItem value="SEED">Seed</SelectItem>
            <SelectItem value="SERIES_A">Series A</SelectItem>
            <SelectItem value="GROWTH">Growth</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sector} onValueChange={(v) => setSector(v)}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {startups.length} startups
      </p>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title="No startups match your filters"
            description="Try clearing the search box or widening the stage / sector filter."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <StartupCard
              key={s.id}
              startup={s}
              locale={locale}
              onRequestMeeting={(id) => setPendingMeetingId(id)}
            />
          ))}
        </div>
      )}

      {pendingMeetingId && (
        <div
          role="status"
          className="fixed bottom-6 end-6 z-50 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
        >
          <p className="text-sm font-medium">Meeting request sent</p>
          <p className="mt-1 text-xs text-muted-foreground">
            We&apos;ll notify the founder. You can review the status in your meetings tab.
          </p>
          <button
            type="button"
            onClick={() => setPendingMeetingId(null)}
            className="mt-3 text-xs font-medium text-primary hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
