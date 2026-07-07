import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarRange,
  Check,
  Network,
  ReceiptText,
  Users,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { assertLandingVisible } from '@/lib/landing-visibility';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.incubators');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

const FEATURE_ICONS = [Building2, CalendarRange, Users, ReceiptText, BarChart3, Network] as const;

export default async function IncubatorsPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('incubators');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.incubators');

  const stats = [
    { value: '1', label: t('stat1Label') },
    { value: '0%', label: t('stat2Label') },
    { value: '3', label: t('stat3Label') },
    { value: '24/7', label: t('stat4Label') },
  ];

  const features = FEATURE_ICONS.map((icon, i) => ({
    icon,
    title: t(`feature${i + 1}Title`),
    description: t(`feature${i + 1}Desc`),
  }));

  const steps = [
    { step: '01', title: t('step1Title'), description: t('step1Desc') },
    { step: '02', title: t('step2Title'), description: t('step2Desc') },
    { step: '03', title: t('step3Title'), description: t('step3Desc') },
  ];

  const networkPoints = [t('networkPoint1'), t('networkPoint2'), t('networkPoint3')];

  return (
    <div className="bg-background">
      {/* ── Hero ── */}
      <section className="border-b border-border/60 bg-gradient-to-b from-primary-50/50 to-background">
        <Container size="xl" className="py-20 sm:py-28 lg:py-32">
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
                <Link href="/signup">
                  {t('heroPrimaryCta')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="/pricing#incubator">{t('heroSecondaryCta')}</Link>
              </Button>
            </div>
          </div>
        </Container>

        {/* Stats strip */}
        <div className="border-t border-border/60 bg-muted/20">
          <Container size="xl" className="py-8">
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {stats.map(({ value, label }) => (
                <div key={label} className="text-center">
                  <dd className="text-3xl font-bold tracking-tight text-foreground">{value}</dd>
                  <dt className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                  </dt>
                </div>
              ))}
            </dl>
          </Container>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('featuresEyebrow')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('featuresTitle')}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t('featuresSubtitle')}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group rounded-xl border border-border/60 bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md"
              >
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-border/60 bg-muted/25 py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('howEyebrow')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('howTitle')}
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {steps.map(({ step, title, description }) => (
              <div key={step} className="relative">
                <span className="select-none text-6xl font-bold text-primary-100">{step}</span>
                <h3 className="mt-2 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── National network ── */}
      <section className="py-20 sm:py-28">
        <Container size="xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
                {t('networkEyebrow')}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {t('networkTitle')}
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                {t('networkDesc')}
              </p>
              <ul className="mt-8 space-y-4">
                {networkPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                      <Check className="size-3" strokeWidth={3} />
                    </div>
                    <span className="text-sm leading-relaxed text-muted-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary-50/60 to-background p-8 sm:p-10">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary-600 text-primary-foreground">
                <Network className="size-6" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-foreground">{t('networkCardTitle')}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t('networkCardDesc')}
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href="/pricing#incubator">
                  {t('networkCardCta')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-border/60 bg-muted/25 py-20 sm:py-28">
        <Container size="md" className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t('ctaTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t('ctaSubtitle')}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/signup">
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
