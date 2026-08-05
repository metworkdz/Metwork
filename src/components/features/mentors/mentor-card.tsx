'use client';

/**
 * Canonical mentor discovery card — the ONE component both the public
 * /mentors page and the dashboard consultations page render. Structure
 * borrows from `SpaceCard` (floated category pill, price + CTA row);
 * styling uses the same semantic tokens (`bg-card`, `border-border`,
 * `text-foreground`/`text-muted-foreground`) as `LandingMentorCard` and
 * `MentorsDirectory` — the existing mentor-feature convention, not the
 * spaces feature's separate hardcoded-slate palette.
 *
 * `href` (public use) makes the whole card a link into the existing
 * profile/booking flow. `onBook` (both surfaces) renders a Book CTA.
 * Omitting `href` (dashboard use) keeps the card from navigating away
 * from the authenticated dashboard — Book is the only action.
 */
import { useTranslations } from 'next-intl';
import { Calendar, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import { resolveMentorCard } from '@/lib/mentor-directory';
import type { Mentor } from '@/types/mentor';
import type { MentorCategoryRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

interface MentorCardProps {
  mentor: Mentor;
  categories: MentorCategoryRecord[];
  locale: Locale;
  href?: string;
  onBook?: () => void;
  /** AI-match pin — renders a "Recommended" pill. The match reason itself is never shown in the UI. */
  isRecommended?: boolean;
}

export function MentorCard({ mentor, categories, locale, href, onBook, isRecommended }: MentorCardProps) {
  const t = useTranslations('mentors.directory');
  const tCommon = useTranslations('common');
  const entry = resolveMentorCard(mentor, categories, locale);

  const body = (
    <>
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {entry.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.photoUrl}
            alt={entry.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            {t('noPhoto')}
          </div>
        )}
        {entry.categories.length > 0 && (
          <div className="absolute start-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
            {entry.categories.slice(0, 2).map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm"
              >
                {c.label}
              </span>
            ))}
          </div>
        )}
        {isRecommended && (
          <span className="absolute end-3 top-3 inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm">
            {t('recommended')}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="line-clamp-1 font-semibold tracking-tight text-foreground">{entry.name}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{entry.shortBio}</p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {entry.isPriced ? formatCurrency(entry.price, locale) : tCommon('free')}
          </span>
          {href && (
            <span
              aria-hidden
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-all duration-150 group-hover:gap-1.5"
            >
              {t('viewProfile')}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <article
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 ease-out',
        'hover:-translate-y-1 hover:border-foreground/20 hover:shadow-xl hover:shadow-foreground/5',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
      )}
    >
      {href ? (
        <Link href={href} className="flex flex-1 flex-col outline-none">
          {body}
        </Link>
      ) : (
        <div className="flex flex-1 flex-col">{body}</div>
      )}

      {onBook && (
        <div className="p-4 pt-0">
          <Button size="sm" className="w-full" onClick={onBook}>
            <Calendar className="size-3.5" />
            {t('book')}
          </Button>
        </div>
      )}
    </article>
  );
}
