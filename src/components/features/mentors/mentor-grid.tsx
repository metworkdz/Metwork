'use client';

/**
 * Canonical mentor grid — filters the given mentors by the selected
 * category ids (OR semantics: shown if the mentor has ANY selected
 * category) and renders `MentorCard`s. Shared by the public /mentors page
 * and the dashboard consultations page.
 *
 * `mentors: undefined` + `loading` renders skeleton cards (no generic
 * `Skeleton` primitive exists in this codebase — this follows the same
 * ad-hoc `animate-pulse` convention as `dashboard/loading.tsx`). Neither
 * consuming page actually triggers this today (both are RSCs that already
 * have the full mentor list at first paint) — it's a real, tested
 * capability of the shared component for any future client-fetch consumer.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Users } from 'lucide-react';
import { MentorCard } from './mentor-card';
import type { Mentor } from '@/types/mentor';
import type { MentorCategoryRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

interface MentorGridProps {
  mentors: Mentor[] | undefined;
  categories: MentorCategoryRecord[];
  selectedCategoryIds: string[];
  locale: Locale;
  loading?: boolean;
  hrefFor?: (mentor: Mentor) => string;
  onBook?: (mentor: Mentor) => void;
}

export function MentorGrid({
  mentors,
  categories,
  selectedCategoryIds,
  locale,
  loading = false,
  hrefFor,
  onBook,
}: MentorGridProps) {
  const t = useTranslations('mentors.directory');

  const filtered = useMemo(() => {
    if (!mentors) return [];
    if (selectedCategoryIds.length === 0) return mentors;
    return mentors.filter((m) =>
      (m.categoryIds ?? []).some((id) => selectedCategoryIds.includes(id)),
    );
  }, [mentors, selectedCategoryIds]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="aspect-[4/3] w-full animate-pulse bg-muted" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="space-y-2 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted/60" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!mentors || mentors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 py-16 text-center">
        <Users className="size-9 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">{t('noMentors')}</p>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 py-16 text-center">
        <Search className="size-9 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">{t('noResultsForCategory')}</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {filtered.map((m) => (
        <li key={m.id}>
          <MentorCard
            mentor={m}
            categories={categories}
            locale={locale}
            href={hrefFor?.(m)}
            onBook={onBook ? () => onBook(m) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}
