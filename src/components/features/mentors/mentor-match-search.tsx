'use client';

/**
 * AI-assisted "describe your problem" search — shared by the public
 * /mentors page and the dashboard consultations page. Explicit submit only
 * (button or Enter), never on keystroke, per the cost-safety requirement.
 *
 * Failure is always silent: a non-2xx response, a network error, or an
 * empty match list all resolve to `onMatch(null)` — the grid behaves
 * exactly like plain category browsing. No error state is ever rendered.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/i18n/config';

export interface MentorMatchResult {
  mentorId: string;
  reason: string;
}

interface MentorMatchSearchProps {
  locale: Locale;
  onMatch: (matches: MentorMatchResult[] | null) => void;
}

export function MentorMatchSearch({ locale, onMatch }: MentorMatchSearchProps) {
  const t = useTranslations('mentors.directory');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    onMatch(null);
    try {
      const res = await fetch('/api/mentors/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, locale }),
      });
      if (!res.ok) {
        onMatch(null);
        return;
      }
      const data = await res.json() as { matches?: MentorMatchResult[] };
      onMatch(data.matches && data.matches.length > 0 ? data.matches : null);
    } catch {
      onMatch(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={t('matchPlaceholder')}
        aria-label={t('matchPlaceholder')}
        disabled={loading}
        className="ps-10 pe-24"
      />
      <Button
        type="button"
        size="sm"
        onClick={submit}
        disabled={loading || !query.trim()}
        aria-label={t('matchSubmitLabel')}
        className="absolute end-1.5 top-1/2 -translate-y-1/2"
      >
        {loading ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            {t('matchLoading')}
          </>
        ) : (
          t('matchSubmitLabel')
        )}
      </Button>
    </div>
  );
}
