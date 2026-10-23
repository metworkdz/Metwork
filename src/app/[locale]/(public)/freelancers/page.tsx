import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  FileSignature,
  FileText,
  Link2,
  Sparkles,
  Users,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { assertLandingVisible } from '@/lib/landing-visibility';
import { getPlanConfig, pricesForConfig } from '@/server/memberships/plan-config';
import { isFreelancerPremiumOnSale } from '@/config/feature-flags';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

// ISR so the admin landing-visibility toggle and plan price propagate without a redeploy.
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('freelancers');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.freelancers');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Features in display order. `live` marks what a freelancer gets the day they
 * join; the rest ship in later Metwork 2.0 phases and are tagged "Soon" so the
 * page never promises today what the product cannot deliver yet. Flip an
 * entry to live in the phase that ships it.
 */
const FEATURES = [
  { key: 'f1', icon: BadgeCheck, live: true },
  { key: 'f2', icon: Users, live: false },
  { key: 'f3', icon: FileText, live: false },
  { key: 'f4', icon: Link2, live: false },
  { key: 'f5', icon: CalendarClock, live: false },
  { key: 'f6', icon: Sparkles, live: false },
  { key: 'f7', icon: FileSignature, live: false },
  { key: 'f8', icon: Building2, live: false },
] as const;

export default async function FreelancersPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('freelancers');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.freelancers');
  const premium = await getPlanConfig('FREELANCER_PREMIUM');
  const premiumMonthly = premium ? pricesForConfig(premium).monthly : 0;
  const premiumOnSale = isFreelancerPremiumOnSale();

  const steps = [
    { step: '01', title: t('step1Title'), description: t('step1Desc') },
    { step: '02', title: t('step2Title'), description: t('step2Desc') },
    { step: '03', title: t('step3Title'), description: t('step3Desc') },
  ];

  return (
    <div className="bg-background">
      {/* ── Hero ── */}
      <section className="border-b border-border/60 bg-gradient-to-b from-primary-50/50 to-background">
        <Container size="xl" className="py-16 sm:py-24 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('heroEyebrow')}
            </p>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {t('heroTitle')}{' '}
              <span className="text-primary-600">{t('heroTitleHighlight')}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t('heroSubtitle')}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/join/freelancer">
                  {t('heroPrimaryCta')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="#plans">{t('heroSecondaryCta')}</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{t('trialNote')}</p>
          </div>
        </Container>
      </section>

      {/* ── Features ── */}
      <section className="py-16 sm:py-24">
        <Container size="xl">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('featuresEyebrow')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('featuresTitle')}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('featuresSubtitle')}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, icon: Icon, live }) => (
              <div key={key} className="rounded-xl border border-border/60 bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <Icon className="size-5" />
                  </div>
                  {!live && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('soon')}
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{t(`${key}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`${key}Desc`)}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-border/60 bg-muted/25 py-16 sm:py-24">
        <Container size="xl">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">{t('howEyebrow')}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('howTitle')}</h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {steps.map(({ step, title, description }) => (
              <div key={step}>
                <span className="select-none text-6xl font-bold text-primary-100">{step}</span>
                <h3 className="mt-2 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Plans ── */}
      <section id="plans" className="scroll-mt-20 py-16 sm:py-24">
        <Container size="xl">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">{t('plansEyebrow')}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('plansTitle')}</h2>
          </div>
          <div className="grid max-w-4xl gap-5 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card p-6">
              <h3 className="text-lg font-semibold">{t('plansFreeName')}</h3>
              <p className="mt-1 text-3xl font-bold">{formatCurrency(0, locale as Locale)}</p>
              <p className="mt-3 text-sm text-muted-foreground">{t('plansFreeDesc')}</p>
            </div>
            <div className="rounded-xl border-2 border-primary bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold">{t('plansPremiumName')}</h3>
                {!premiumOnSale && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('plansPremiumSoon')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-3xl font-bold">
                {t('plansPremiumPrice', { price: formatCurrency(premiumMonthly, locale as Locale) })}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{t('plansPremiumDesc')}</p>
            </div>
          </div>
          {premiumOnSale && (
            <Link href="/pricing#freelancers" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
              {t('plansLink')}
            </Link>
          )}
        </Container>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-border/60 bg-muted/25 py-16 sm:py-24">
        <Container size="md" className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('ctaTitle')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">{t('ctaSubtitle')}</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/join/freelancer">
                {t('ctaPrimary')}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="/contact">{t('ctaSecondary')}</Link>
            </Button>
          </div>
        </Container>
      </section>
    </div>
  );
}
