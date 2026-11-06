import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Infinity as InfinityIcon, Layers } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { getPublicBundle } from '@/server/academy/bundles';
import { listAcademyFields } from '@/server/academy/settings';
import { resolveText } from '@/lib/localized-text';
import { CourseCard } from '@/components/features/academy/course-card';
import { formatDzd } from '@/components/features/academy/format';

export const revalidate = 60;

interface PageProps { params: Promise<{ locale: string; slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const path = await getPublicBundle(slug, locale);
  return path ? { title: path.title, description: path.description.slice(0, 160) } : {};
}

/** A learning path: its courses in order, bought together for one price. */
export default async function AcademyPathPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const path = await getPublicBundle(slug, locale);
  if (!path) notFound();
  const t = await getTranslations('academy');
  const fields = await listAcademyFields({ includeHidden: true });
  const fieldLabel = (id: string) => { const f = fields.find((x) => x.id === id); return f?.label ? resolveText(f.label, locale) : t(`fields.${id}.name`); };
  const money = (n: number) => t('money', { price: formatDzd(n, locale) });
  const saving = path.listTotalDzd - path.priceDzd;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary"><Layers className="size-4" aria-hidden />{t('paths.eyebrow', { count: path.courses.length })}</p>
      <h1 className="mt-2 text-balance font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{path.title}</h1>
      {path.description && <p className="mt-3 max-w-3xl whitespace-pre-line text-pretty text-muted-foreground">{path.description}</p>}

      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-display text-3xl font-extrabold">{money(path.priceDzd)}</p>
          {saving > 0 && <p className="text-sm text-muted-foreground">{t('paths.saving', { list: money(path.listTotalDzd), saving: money(saving) })}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><InfinityIcon className="size-4 text-primary" aria-hidden />{t('paths.lifetime')}</p>
        </div>
        <Button asChild size="lg" className="font-bold"><Link href={{ pathname: '/academy/checkout', query: { bundle: path.slug } }}>{t('paths.buy')}</Link></Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('paths.ownedHint')}</p>

      <h2 className="mt-10 font-display text-xl font-extrabold">{t('paths.programme')}</h2>
      <ol className="mt-4 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {path.courses.map((c, i) => (
          <li key={c.id}>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary">{t('paths.step', { n: i + 1 })}</p>
            <CourseCard course={c} locale={locale} fieldLabel={fieldLabel(c.fieldId)} />
          </li>
        ))}
      </ol>
    </div>
  );
}
