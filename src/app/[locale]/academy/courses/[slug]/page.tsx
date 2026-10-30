import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Award, CheckCircle2, Clock, Infinity as InfinityIcon, Languages, Lock, PlayCircle, Signal } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { getPublicCourse } from '@/server/academy/catalog';
import { getAcademyPricing, listAcademyFields } from '@/server/academy/settings';
import { passPrices } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { siteConfig } from '@/config/site';
import { CourseCover } from '@/components/features/academy/course-cover';
import { CourseCta } from '@/components/features/academy/course-cta';
import { formatClock, formatDuration, formatDzd } from '@/components/features/academy/format';

export const revalidate = 60;

interface PageProps { params: Promise<{ locale: string; slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const course = await getPublicCourse(slug, locale);
  if (!course) return {};
  const description = (course.subtitle || course.description).slice(0, 160);
  return {
    title: course.title,
    description,
    openGraph: { title: course.title, description, images: course.thumbnailUrl ? [course.thumbnailUrl] : undefined },
  };
}

export default async function AcademyCoursePage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const course = await getPublicCourse(slug, locale);
  if (!course) notFound();
  const t = await getTranslations('academy');
  const [fields, pricing] = await Promise.all([listAcademyFields({ includeHidden: true }), getAcademyPricing()]);
  const field = fields.find((f) => f.id === course.fieldId);
  const fieldLabel = field?.label ? resolveText(field.label, locale) : t(`fields.${course.fieldId}.name`);
  const pass = passPrices(pricing);
  const premiumPercent = Math.round(pricing.premiumDiscountRate * 100);

  // Search engines: a Course with its provider and price.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.title,
    description: course.subtitle || course.description.slice(0, 300),
    inLanguage: locale,
    provider: { '@type': 'Organization', name: siteConfig.name, sameAs: process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz' },
    offers: { '@type': 'Offer', category: 'Paid', price: course.priceDzd, priceCurrency: 'DZD' },
  };

  return (
    <div>
      {/* eslint-disable-next-line react/no-danger -- JSON.stringify output, `<` escaped below */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
          <div className="min-w-0">
            <nav className="text-xs text-muted-foreground">
              <Link href="/academy/courses" className="hover:text-foreground">{t('catalog.title')}</Link>
              <span className="mx-1.5">›</span>
              <Link href={{ pathname: '/academy/courses', query: { field: course.fieldId } }} className="hover:text-foreground">{fieldLabel}</Link>
            </nav>
            <h1 className="mt-3 text-balance font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{course.title}</h1>
            {course.subtitle && <p className="mt-3 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">{course.subtitle}</p>}
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5"><Signal className="size-4" aria-hidden />{t(`levels.${course.level}`)}</li>
              <li className="flex items-center gap-1.5"><Languages className="size-4" aria-hidden />{t(`audio.${course.audioLanguage}`)}</li>
              <li className="flex items-center gap-1.5"><PlayCircle className="size-4" aria-hidden />{t('card.lessons', { count: course.lessonCount })}</li>
              {course.durationSec > 0 && <li className="flex items-center gap-1.5"><Clock className="size-4" aria-hidden />{formatDuration(course.durationSec, t)}</li>}
            </ul>
            {course.mentors.length > 0 && (
              <p className="mt-4 text-sm">
                {t('course.by')}{' '}
                {course.mentors.map((m, i) => (
                  <span key={m.id}>{i > 0 && ', '}<Link href={`/academy/mentors/${m.slug}`} className="font-semibold text-primary hover:underline">{m.fullName}</Link></span>
                ))}
              </p>
            )}
          </div>

          {/* Purchase card */}
          <aside className="lg:row-span-2">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-black/5 lg:sticky lg:top-24">
              <CourseCover course={course} fieldLabel={fieldLabel} className="rounded-none" large />
              <div className="space-y-3 p-5">
                <p className="font-display text-3xl font-extrabold">{t('money', { price: formatDzd(course.priceDzd, locale) })}</p>
                <p className="text-sm text-amber-700 dark:text-amber-400">{t('course.premiumLine', { price: formatDzd(course.premiumPriceDzd, locale), percent: premiumPercent })}</p>
                <CourseCta slug={course.slug} />
                {course.includedInPass && (
                  <Link href="/academy/pass" className="block rounded-xl border border-primary/40 p-3 text-sm hover:bg-primary/5">
                    <span className="font-bold text-primary">{t('course.inPassTitle')}</span>
                    <span className="block text-muted-foreground">{t('course.inPassDesc', { price: formatDzd(pass.monthly, locale) })}</span>
                  </Link>
                )}
                <ul className="space-y-1.5 pt-1 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><InfinityIcon className="size-4 text-primary" aria-hidden />{t('course.lifetime')}</li>
                  <li className="flex items-center gap-2"><Award className="size-4 text-primary" aria-hidden />{t('course.certificate')}</li>
                  {course.comingSoonModules > 0 && <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" aria-hidden />{t('course.futureModules')}</li>}
                  <li className="flex items-center gap-2"><Lock className="size-4 text-primary" aria-hidden />{t('course.streamOnly')}</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
        <div className="min-w-0 space-y-10">
          {course.outcomes.length > 0 && (
            <section className="rounded-2xl border border-border p-5 sm:p-6">
              <h2 className="font-display text-xl font-extrabold">{t('course.outcomes')}</h2>
              <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {course.outcomes.map((o, i) => (
                  <li key={i} className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{o}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl font-extrabold">{t('course.programme')}</h2>
              <p className="text-sm text-muted-foreground">{t('course.programmeSummary', { modules: course.modules.length, lessons: course.lessonCount })}</p>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-border">
              {course.modules.map((m, i) => (
                <details key={m.id} open={i === 0} className="group border-b border-border last:border-b-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/40 px-4 py-3.5 font-semibold">
                    <span className="min-w-0">{t('course.module', { n: i + 1 })} · {m.title}</span>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {m.comingSoon ? <span className="rounded-full bg-muted px-2 py-0.5">{t('course.soon')}</span> : t('card.lessons', { count: m.lessons.length })}
                    </span>
                  </summary>
                  <ul className="px-2 py-2 text-sm">
                    {m.lessons.map((l) => (
                      <li key={l.id} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${m.comingSoon ? 'text-muted-foreground' : ''}`}>
                        <span className="flex min-w-0 items-center gap-2">
                          {l.isPreview ? <PlayCircle className="size-4 shrink-0 text-primary" aria-hidden /> : <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                          <span className="truncate">{l.title}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                          {l.isPreview && <span className="font-bold text-primary">{t('course.preview')}</span>}
                          {formatClock(l.durationSec)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>

          {course.description && (
            <section>
              <h2 className="font-display text-xl font-extrabold">{t('course.about')}</h2>
              <p className="mt-3 whitespace-pre-line text-pretty leading-relaxed text-muted-foreground">{course.description}</p>
            </section>
          )}

          {course.mentors.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-extrabold">{course.mentors.length > 1 ? t('course.mentors') : t('course.mentor')}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {course.mentors.map((m) => (
                  <Link key={m.id} href={`/academy/mentors/${m.slug}`} className="flex items-center gap-4 rounded-2xl border border-border p-4 hover:border-primary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="size-14 rounded-full object-cover" /> : <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 font-display font-extrabold text-primary">{m.fullName.slice(0, 1)}</span>}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{m.fullName}</span>
                      <span className="block truncate text-sm text-muted-foreground">{m.position}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
