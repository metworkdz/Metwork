import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { CATALOG_SORTS, listPublicCourses, type CatalogSort } from '@/server/academy/catalog';
import { listAcademyFields } from '@/server/academy/settings';
import { ACADEMY_AUDIO_LANGUAGES, ACADEMY_LEVELS, type AcademyAudioLanguage, type AcademyLevel } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { CourseCard } from '@/components/features/academy/course-card';
import { PathCard } from '@/components/features/academy/path-card';
import { listPublicBundles } from '@/server/academy/bundles';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academy.catalog');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * /academy/courses — the catalogue. Filters are plain GET parameters, so a
 * filtered list can be shared and the form works before JavaScript loads.
 */
export default async function AcademyCatalogPage({ params, searchParams }: PageProps) {
  assertAcademyEnabled();
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('academy');

  const fields = await listAcademyFields();
  const fieldId = fields.some((f) => f.id === one(sp.field)) ? one(sp.field) : '';
  const level = (ACADEMY_LEVELS as readonly string[]).includes(one(sp.level)) ? (one(sp.level) as AcademyLevel) : null;
  const audio = (ACADEMY_AUDIO_LANGUAGES as readonly string[]).includes(one(sp.audio)) ? (one(sp.audio) as AcademyAudioLanguage) : null;
  const sort = (CATALOG_SORTS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as CatalogSort) : 'newest';
  const inPass = one(sp.pass) === '1';
  const q = one(sp.q).slice(0, 80);

  const courses = await listPublicCourses(locale, { fieldId: fieldId || null, level, audioLanguage: audio, inPass, q, sort });
  const fieldLabel = (id: string) => {
    const f = fields.find((x) => x.id === id);
    return f?.label ? resolveText(f.label, locale) : t(`fields.${id}.name`);
  };
  const filtered = Boolean(fieldId || level || audio || inPass || q);
  // Learning paths head the unfiltered catalogue.
  const paths = filtered ? [] : await listPublicBundles(locale);
  const select = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm';

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{fieldId ? fieldLabel(fieldId) : t('catalog.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('catalog.count', { count: courses.length })}</p>

      {paths.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-extrabold">{t('paths.title')}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paths.map((p) => <PathCard key={p.id} path={p} locale={locale} />)}
          </div>
        </section>
      )}

      {/* Field chips: the quickest filter, one tap on a phone. */}
      <nav aria-label={t('catalog.fields')} className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Link href={{ pathname: '/academy/courses', query: { ...(q ? { q } : {}) } }}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${!fieldId ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          {t('catalog.all')}
        </Link>
        {fields.map((f) => (
          <Link key={f.id} href={{ pathname: '/academy/courses', query: { field: f.id, ...(q ? { q } : {}) } }}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${fieldId === f.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {fieldLabel(f.id)}
          </Link>
        ))}
      </nav>

      <form method="get" className="mt-6 space-y-3 rounded-2xl border border-border bg-card p-4">
        {fieldId && <input type="hidden" name="field" value={fieldId} />}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">{t('catalog.search')}</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input name="q" defaultValue={q} maxLength={80} placeholder={t('catalog.searchPlaceholder')} className={`${select} ps-9`} />
          </label>
          <Button type="submit">{t('catalog.apply')}</Button>
        </div>
        {/* Secondary filters fold away so the courses stay in view on a phone; open when one is in use. */}
        <details open={Boolean(level || audio || inPass || sort !== 'newest')} className="group">
          <summary className="cursor-pointer list-none text-sm font-semibold text-primary">
            <span className="group-open:hidden">{t('catalog.moreFilters')}</span>
            <span className="hidden group-open:inline">{t('catalog.fewerFilters')}</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="space-y-1 text-sm font-medium">
              <span>{t('catalog.level')}</span>
              <select name="level" defaultValue={level ?? ''} className={select}>
                <option value="">{t('catalog.any')}</option>
                {ACADEMY_LEVELS.map((l) => <option key={l} value={l}>{t(`levels.${l}`)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>{t('catalog.audio')}</span>
              <select name="audio" defaultValue={audio ?? ''} className={select}>
                <option value="">{t('catalog.any')}</option>
                {ACADEMY_AUDIO_LANGUAGES.map((a) => <option key={a} value={a}>{t(`audio.${a}`)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>{t('catalog.sort')}</span>
              <select name="sort" defaultValue={sort} className={select}>
                {CATALOG_SORTS.map((s) => <option key={s} value={s}>{t(`catalog.sorts.${s}`)}</option>)}
              </select>
            </label>
            <label className="flex h-10 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" name="pass" value="1" defaultChecked={inPass} className="size-4 accent-[hsl(var(--primary))]" />
              {t('catalog.inPass')}
            </label>
          </div>
        </details>
      </form>

      {courses.length ? (
        <div className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {courses.map((c) => <CourseCard key={c.id} course={c} locale={locale} fieldLabel={fieldLabel(c.fieldId)} />)}
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-display text-lg font-extrabold">{filtered ? t('catalog.noMatch') : t('catalog.empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{filtered ? t('catalog.noMatchHint') : t('catalog.emptyHint')}</p>
          {filtered && <Button asChild variant="outline" className="mt-4"><Link href="/academy/courses">{t('catalog.reset')}</Link></Button>}
        </div>
      )}
    </div>
  );
}
