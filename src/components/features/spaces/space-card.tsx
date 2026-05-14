/**
 * Premium marketplace card for a single coworking space.
 *
 * Design:
 *  - Full-bleed image / illustrated placeholder (top, 4:3 ratio)
 *  - Category badge floated on image, glassmorphism pill
 *  - Rating badge (top-right) when available
 *  - Clean two-row metadata (name + location)
 *  - Subtle description (2 lines)
 *  - Price row with animated "View →" CTA
 *  - Hover: shadow lift + very subtle scale; no jarring transitions
 */
import { useTranslations } from 'next-intl';
import { ArrowRight, MapPin, Star } from 'lucide-react';
import { SpaceImage } from './space-image';
import { categoryLabel } from './space-meta';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Space } from '@/types/domain';

interface SpaceCardProps {
  space: Space;
  locale: Locale;
  onSelect: (space: Space) => void;
}

type PriceSuffixKey = 'perHour' | 'perDay' | 'perMonth';

function startingPrice(space: Space): { amount: number; suffixKey: PriceSuffixKey } | null {
  if (space.pricePerHour  != null) return { amount: space.pricePerHour,  suffixKey: 'perHour'  };
  if (space.pricePerDay   != null) return { amount: space.pricePerDay,   suffixKey: 'perDay'   };
  if (space.pricePerMonth != null) return { amount: space.pricePerMonth, suffixKey: 'perMonth' };
  return null;
}

export function SpaceCard({ space, locale, onSelect }: SpaceCardProps) {
  const t = useTranslations('spaces.card');
  const price = startingPrice(space);

  return (
    <article
      role="article"
      tabIndex={0}
      onClick={() => onSelect(space)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(space); }
      }}
      aria-label={`${space.name} — ${categoryLabel[space.category]}, ${space.city}`}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white',
        'shadow-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.10)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
      )}
    >
      {/* ── Image / Placeholder ── */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {/* scale on hover via the image wrapper, not the whole card */}
        <div className="size-full transition-transform duration-500 group-hover:scale-[1.03]">
          <SpaceImage
            category={space.category}
            imageUrl={space.imageUrl}
            alt={space.name}
            className="size-full object-cover"
          />
        </div>

        {/* Category badge — glassmorphism pill */}
        <div className="absolute start-3 top-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-sm backdrop-blur-sm">
            {categoryLabel[space.category]}
          </span>
        </div>

        {/* Rating badge */}
        {space.rating != null && (
          <div className="absolute end-3 top-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-sm backdrop-blur-sm">
              <Star className="size-3 fill-amber-400 stroke-amber-400" />
              {space.rating.toFixed(1)}
              {space.reviewCount > 0 && (
                <span className="font-normal text-slate-400">({space.reviewCount})</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex flex-col p-5">
        {/* Name */}
        <h3 className="line-clamp-1 text-[0.9375rem] font-bold text-slate-900 transition-colors group-hover:text-primary">
          {space.name}
        </h3>

        {/* Location */}
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
          <MapPin className="size-3 shrink-0" />
          <span className="line-clamp-1">
            {space.city}
            {space.incubatorName && (
              <> · <span className="text-slate-500">{space.incubatorName}</span></>
            )}
          </span>
        </p>

        {/* Description */}
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-500">
          {space.description}
        </p>

        {/* ── Price + CTA ── */}
        <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-4">
          {price ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t('from')}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {formatCurrency(price.amount, locale)}
                <span className="ms-1 text-xs font-normal text-slate-400">{t(price.suffixKey)}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">{t('contactForPricing')}</p>
          )}

          <span
            aria-hidden
            className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold text-primary',
              'transition-all duration-150 group-hover:gap-2',
            )}
          >
            {t('viewDetails')}
            <ArrowRight className="size-3.5" />
          </span>
        </div>
      </div>
    </article>
  );
}
