import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Rocket, Briefcase, TrendingUp, Building2, GraduationCap, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { JOIN_SLUGS, type JoinSlug } from '@/config/join-pages';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('join');
  return { title: t('chooserTitle') };
}

const ICONS: Record<JoinSlug, typeof Rocket> = {
  entrepreneur: Rocket,
  freelancer: Briefcase,
  investor: TrendingUp,
  space: Building2,
};

/** /join — for visitors who have not said who they are yet. */
export default async function JoinChooserPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('join');
  // Carry a public "book before you sign up" intent through to the form.
  const intent = (await searchParams).bookingIntent;
  const query = typeof intent === 'string' ? `?bookingIntent=${encodeURIComponent(intent)}` : '';

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('chooserTitle')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('chooserSubtitle')}</p>
      </div>
      <ul className="space-y-3">
        {(Object.keys(JOIN_SLUGS) as JoinSlug[]).map((slug) => {
          const Icon = ICONS[slug];
          return (
            <li key={slug}>
              <Link
                href={`/join/${slug}${query}`}
                className="group flex min-h-[64px] items-center gap-4 rounded-lg border-2 border-border bg-background p-4 transition-all hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary-50 group-hover:text-primary-600">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{t(`${slug}.card`)}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t(`${slug}.cardDesc`)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
              </Link>
            </li>
          );
        })}
        <li>
          {/* Consultants sign up in their own portal (prefix-free URL, its own PWA scope). */}
          <a
            href="/consultant/login?signup=1"
            className="group flex min-h-[64px] items-center gap-4 rounded-lg border-2 border-border bg-background p-4 transition-all hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary-50 group-hover:text-primary-600">
              <GraduationCap className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{t('consultant.card')}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t('consultant.cardDesc')}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
          </a>
        </li>
      </ul>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link href={`/login${query}`} className="font-medium text-primary hover:underline">
          {t('login')}
        </Link>
      </p>
    </div>
  );
}
