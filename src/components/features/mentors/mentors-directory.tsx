'use client';

/**
 * MentorsDirectory — the public mentor grid (replaces the slideshow as the
 * primary directory view). Responsive cards with photo, name, position, a
 * two-line bio clamp, a "View profile" link to /mentors/[slug] and a quick
 * "Book" affordance. Client-side search (name / position / bio) + an optional
 * area filter derived from distinct positions. Keyboard-navigable (native
 * links + buttons) with empty / no-results states.
 */
import { useMemo, useState } from 'react';
import { Search, Calendar, ArrowRight, X, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { BookConsultationDialog } from './book-consultation-dialog';
import type { Mentor } from '@/types/mentor';

interface MentorsDirectoryProps {
  mentors: Mentor[];
}

const ALL = '__all__';

export function MentorsDirectory({ mentors }: MentorsDirectoryProps) {
  const t = useTranslations('mentors.directory');
  const { user } = useAuth();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<string>(ALL);
  const [booking, setBooking] = useState<Mentor | null>(null);

  // Distinct positions → optional area filter. Free-text, so we just dedupe.
  const positions = useMemo(() => {
    const set = new Set<string>();
    for (const m of mentors) {
      const p = m.position?.trim();
      if (p) set.add(p);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mentors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mentors.filter((m) => {
      if (position !== ALL && m.position?.trim() !== position) return false;
      if (!q) return true;
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.position.toLowerCase().includes(q) ||
        (m.bio?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [mentors, query, position]);

  function hrefFor(m: Mentor): string {
    return `/mentors/${m.slug ?? m.id}`;
  }

  function handleBook(m: Mentor) {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent('/mentors')}`);
      return;
    }
    setBooking(m);
  }

  // No mentors at all.
  if (mentors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 py-20 text-center">
        <Users className="size-10 text-muted-foreground/40" />
        <p className="mt-4 text-sm text-muted-foreground">{t('noMentors')}</p>
      </div>
    );
  }

  const hasFilters = query.trim() !== '' || position !== ALL;

  return (
    <div>
      {/* Controls */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="ps-9"
          />
        </div>

        {positions.length > 1 && (
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger className="sm:w-64" aria-label={t('filterLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filterAll')}</SelectItem>
              {positions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Result count */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filtered.length === 1 ? t('resultOne') : t('resultsCount', { count: filtered.length })}
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setQuery(''); setPosition(ALL); }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
            {t('clear')}
          </button>
        )}
      </div>

      {/* Grid or no-results */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 py-16 text-center">
          <Search className="size-9 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">{t('noResults')}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <li key={m.id}>
              <article
                className={cn(
                  'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 ease-out',
                  'hover:-translate-y-1 hover:border-foreground/20 hover:shadow-xl hover:shadow-foreground/5',
                  'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                )}
              >
                <Link
                  href={hrefFor(m)}
                  className="flex flex-1 flex-col outline-none"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
                    {m.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.imageUrl}
                        alt={m.fullName}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                        {t('noPhoto')}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="line-clamp-1 font-semibold tracking-tight text-foreground">
                      {m.fullName}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {m.position}
                    </p>
                    {m.bio?.trim() && (
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {m.bio}
                      </p>
                    )}
                  </div>
                </Link>

                <div className="flex items-center gap-2 p-4 pt-0">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={hrefFor(m)}>
                      {t('viewProfile')}
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleBook(m)}
                  >
                    <Calendar className="size-3.5" />
                    {t('book')}
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <BookConsultationDialog
        mentor={booking}
        open={booking !== null}
        onOpenChange={(open) => { if (!open) setBooking(null); }}
      />
    </div>
  );
}
