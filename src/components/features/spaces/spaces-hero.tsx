'use client';

/**
 * Immersive hero section for the Spaces marketplace page.
 *
 * Design principles:
 *  - No background images — purely CSS geometry + soft gradients
 *  - Floating white card with premium shadow
 *  - Category cards in WeWork style (icon + label + active state)
 *  - City native-select (avoids Radix portal z-index issues inside card)
 *  - Controlled: category + city state live in the parent SpacesPageClient
 */
import {
  Briefcase,
  Building2,
  ChevronDown,
  GraduationCap,
  LayoutGrid,
  MapPin,
  Search,
  Users2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SpaceCategory } from '@/types/domain';

const ALL = 'all' as const;
export type HeroCategoryFilter = SpaceCategory | typeof ALL;

const CATEGORY_ICONS: Record<HeroCategoryFilter, React.ComponentType<{ className?: string }>> = {
  all:              LayoutGrid,
  COWORKING:        Users2,
  PRIVATE_OFFICE:   Briefcase,
  TRAINING_ROOM:    GraduationCap,
  DOMICILIATION:    Building2,
};
const CATEGORY_VALUES: HeroCategoryFilter[] = ['all', 'COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION'];

interface SpacesHeroProps {
  cities: { code: string; name: string }[];
  category: HeroCategoryFilter;
  city: string;
  totalSpaces: number;
  onCategoryChange: (c: HeroCategoryFilter) => void;
  onCityChange: (c: string) => void;
  onSearch: () => void;
}

export function SpacesHero({
  cities,
  category,
  city,
  totalSpaces,
  onCategoryChange,
  onCityChange,
  onSearch,
}: SpacesHeroProps) {
  const t = useTranslations('spaces.hero');
  const te = useTranslations('spaces.explorer');

  type CatKey = 'all' | 'COWORKING' | 'PRIVATE_OFFICE' | 'TRAINING_ROOM' | 'DOMICILIATION';
  const catLabel: Record<CatKey, string> = {
    all:            t('catAllLabel'),
    COWORKING:      t('catCoworkingLabel'),
    PRIVATE_OFFICE: t('catOfficeLabel'),
    TRAINING_ROOM:  t('catTrainingLabel'),
    DOMICILIATION:  t('catDomiLabel'),
  };
  const catSub: Record<CatKey, string> = {
    all:            t('catAllSub'),
    COWORKING:      t('catCoworkingSub'),
    PRIVATE_OFFICE: t('catOfficeSub'),
    TRAINING_ROOM:  t('catTrainingSub'),
    DOMICILIATION:  t('catDomiSub'),
  };

  return (
    <section
      aria-label="Search workspaces"
      className="relative flex min-h-[88vh] items-center justify-center overflow-hidden bg-white py-16 sm:py-20"
    >
      {/* ── Dot-grid texture ── */}
      <div
        aria-hidden
        className="absolute inset-0 [background-image:radial-gradient(#e2e8f0_1.5px,transparent_1.5px)] [background-size:28px_28px] opacity-70"
      />

      {/* ── Soft ambient blobs ── */}
      <div
        aria-hidden
        className="absolute -right-72 -top-72 size-[700px] rounded-full bg-primary/[0.055] blur-[120px]"
      />
      <div
        aria-hidden
        className="absolute -bottom-72 -left-72 size-[700px] rounded-full bg-emerald-500/[0.045] blur-[120px]"
      />

      {/* ── Corner geometric accents ── */}
      <svg
        aria-hidden
        className="absolute right-6 top-6 opacity-[0.07]"
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
      >
        <circle cx="60" cy="60" r="58" stroke="currentColor" strokeWidth="2" className="text-primary" />
        <circle cx="60" cy="60" r="44" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
        <circle cx="60" cy="60" r="28" stroke="currentColor" strokeWidth="1" className="text-primary" />
      </svg>
      <svg
        aria-hidden
        className="absolute bottom-6 left-6 opacity-[0.06]"
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
      >
        <rect x="2" y="2" width="76" height="76" rx="12" stroke="currentColor" strokeWidth="2" className="text-slate-600" />
        <rect x="14" y="14" width="52" height="52" rx="8" stroke="currentColor" strokeWidth="1.5" className="text-slate-600" />
      </svg>

      {/* ── Floating card ── */}
      <div className="relative z-10 mx-auto w-full max-w-[700px] px-4 sm:px-6">
        <div className="rounded-[28px] bg-white px-7 py-9 shadow-[0_8px_80px_rgba(0,0,0,0.11)] ring-1 ring-black/[0.05] sm:px-12 sm:py-12">

          {/* — Eyebrow — */}
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
            {t('eyebrow')}
          </p>

          {/* — Headline — */}
          <h1 className="mt-2 text-center text-balance text-4xl font-bold tracking-tight text-slate-900 sm:text-[2.75rem] sm:leading-[1.15]">
            {t('headline')}
          </h1>

          {/* — Sub-headline — */}
          <p className="mx-auto mt-4 max-w-md text-center text-balance text-sm text-slate-500 sm:text-[0.9375rem]">
            {t('subheadline')}
          </p>

          {/* — Category cards — */}
          <div
            role="group"
            aria-label="Space category"
            className="mt-8 flex gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible"
          >
            {CATEGORY_VALUES.map((value) => {
              const active = category === value;
              const Icon = CATEGORY_ICONS[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onCategoryChange(value)}
                  aria-pressed={active}
                  className={cn(
                    'group flex shrink-0 flex-col items-center gap-2.5 rounded-2xl border-2 px-3 py-4',
                    'w-[110px] min-w-[90px] text-center transition-all duration-150 select-none sm:w-auto',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    active
                      ? 'border-primary bg-primary/[0.04] shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-sm',
                  )}
                >
                  <div
                    className={cn(
                      'flex size-11 items-center justify-center rounded-xl transition-colors duration-150',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200/80 group-hover:text-slate-700',
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <p
                      className={cn(
                        'text-[11.5px] font-bold leading-tight',
                        active ? 'text-primary' : 'text-slate-700 group-hover:text-slate-900',
                      )}
                    >
                      {catLabel[value as CatKey]}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400 leading-tight">{catSub[value as CatKey]}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* — City + Search row — */}
          <div className="mt-4 flex gap-2.5">
            {/* City picker */}
            <div className="relative flex-1">
              <MapPin className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <select
                value={city}
                onChange={(e) => onCityChange(e.target.value)}
                aria-label="Select city"
                className={cn(
                  'h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white',
                  'ps-10 pe-9 text-sm font-medium text-slate-700 shadow-sm',
                  'transition-colors hover:border-slate-300',
                  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                )}
              >
                <option value={ALL}>{te('allCities')}</option>
                {cities.map((c) => (
                  <option key={c.code} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            </div>

            {/* Search CTA */}
            <Button
              type="button"
              onClick={onSearch}
              className="h-12 gap-2 rounded-xl px-7 text-sm font-semibold shadow-md shadow-primary/20 transition-shadow hover:shadow-lg hover:shadow-primary/25"
            >
              <Search className="size-4" />
              {t('searchButton')}
            </Button>
          </div>
        </div>

        {/* — Trust strip below card — */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            <strong className="font-semibold text-slate-600">{totalSpaces}+</strong>{' '}
            {t('verifiedSpacesSuffix')}
          </span>
          <span className="hidden sm:inline">·</span>
          <span>
            <strong className="font-semibold text-slate-600">{cities.length}</strong>{' '}
            {t('citiesSuffix')}
          </span>
          <span className="hidden sm:inline">·</span>
          <span>{t('bookingModes')}</span>
        </div>
      </div>
    </section>
  );
}
