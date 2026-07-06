import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Globe,
  Rocket,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { StartupCard } from '@/components/features/startups/startup-card';
import { listStartups } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { assertLandingVisible } from '@/lib/landing-visibility';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Invest in Algeria — Metwork',
  description:
    'Discover high-potential Algerian startups. Connect with founders, review opportunities, and invest in the next generation of African tech.',
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

const REASON_ICONS = [Globe, Users, TrendingUp, ShieldCheck, BarChart3, Building2] as const;

export default async function InvestorsPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('investors');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.investors');

  const listings = (await listStartups({ status: 'ACTIVE' })).map(toStartupDto);

  const stats = [
    { value: '47M+',  label: t('stat1Label') },
    { value: '$220B', label: t('stat2Label') },
    { value: '68%',   label: t('stat3Label') },
    { value: '3×',    label: t('stat4Label') },
  ];

  const reasons = [
    { icon: REASON_ICONS[0], title: t('reason1Title'), description: t('reason1Desc') },
    { icon: REASON_ICONS[1], title: t('reason2Title'), description: t('reason2Desc') },
    { icon: REASON_ICONS[2], title: t('reason3Title'), description: t('reason3Desc') },
    { icon: REASON_ICONS[3], title: t('reason4Title'), description: t('reason4Desc') },
    { icon: REASON_ICONS[4], title: t('reason5Title'), description: t('reason5Desc') },
    { icon: REASON_ICONS[5], title: t('reason6Title'), description: t('reason6Desc') },
  ];

  const steps = [
    { step: '01', title: t('step1Title'), description: t('step1Desc') },
    { step: '02', title: t('step2Title'), description: t('step2Desc') },
    { step: '03', title: t('step3Title'), description: t('step3Desc') },
  ];

  return (
    <div className="bg-background">

      {/* ── Hero — deep green ── */}
      <section
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, hsl(142,80%,9%) 0%, hsl(142,72%,14%) 50%, hsl(142,65%,11%) 100%)' }}
      >
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'linear-gradient(hsl(142,60%,50%) 1px,transparent 1px),linear-gradient(90deg,hsl(142,60%,50%) 1px,transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        <Container size="xl" className="relative py-24 sm:py-32 lg:py-40">
          <div className="max-w-3xl">
            {/* Eyebrow */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5">
              <Rocket className="size-3.5 text-emerald-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                {t('heroEyebrow')}
              </span>
            </div>

            <h1 className="text-balance font-display text-display-lg text-white sm:text-display-xl">
              {t('heroHeadlinePre')}{' '}
              <span
                className="relative"
                style={{
                  WebkitTextFillColor: 'transparent',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  backgroundImage: 'linear-gradient(90deg,hsl(45,95%,60%),hsl(38,90%,70%))',
                }}
              >
                {t('heroHeadlineHighlight')}
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-emerald-100/80">
              {t('heroSubheadline')}
            </p>

            {/* CTA buttons */}
            <div className="mt-10 flex flex-wrap gap-4">
              {/* Golden primary CTA */}
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  background: 'linear-gradient(135deg, hsl(42,95%,52%) 0%, hsl(36,90%,48%) 100%)',
                  boxShadow: '0 4px 20px hsla(42,95%,52%,0.35)',
                }}
              >
                {t('heroContact')}
                <ArrowRight className="size-4" />
              </Link>

              {/* Secondary outline */}
              <Link
                href="#listings"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              >
                {t('heroExplore')}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </Container>

        {/* Stats strip */}
        <div
          className="border-t"
          style={{ borderColor: 'hsla(142,60%,50%,0.2)', background: 'hsla(142,80%,7%,0.7)' }}
        >
          <Container size="xl" className="py-8">
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {stats.map(({ value, label }) => (
                <div key={label} className="text-center">
                  <dd className="text-3xl font-bold tracking-tight text-white">{value}</dd>
                  <dt className="mt-1 text-xs font-medium uppercase tracking-wider text-emerald-300/70">
                    {label}
                  </dt>
                </div>
              ))}
            </dl>
          </Container>
        </div>
      </section>

      {/* ── Why Algeria ── */}
      <section className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('whyEyebrow')}
            </p>
            <h2 className="mt-3 text-display-sm font-display tracking-tight text-foreground sm:text-display-md">
              {t('whyHeadline')}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t('whyDesc')}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {reasons.map(({ icon: Icon, title, description }) => (
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
      <section
        className="py-20 sm:py-28"
        style={{ background: 'hsl(142,76%,97%)' }}
      >
        <Container size="xl">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('howEyebrow')}
            </p>
            <h2 className="mt-3 text-display-sm font-display tracking-tight text-foreground sm:text-display-md">
              {t('howHeadline')}
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {steps.map(({ step, title, description }) => (
              <div key={step} className="relative">
                <span className="text-6xl font-bold text-primary-100 select-none">{step}</span>
                <h3 className="mt-2 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap gap-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-sm font-bold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg"
              style={{
                background: 'linear-gradient(135deg, hsl(42,95%,52%) 0%, hsl(36,90%,48%) 100%)',
              }}
            >
              {t('howStart')}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-7 py-3.5 text-sm font-semibold text-primary-700 shadow-sm transition-all hover:bg-primary-50"
            >
              {t('howTalk')}
            </Link>
          </div>
        </Container>
      </section>

      {/* ── Active listings ── */}
      <section id="listings" className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-10">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('listingsEyebrow')}
            </p>
            <h2 className="mt-3 text-display-sm font-display tracking-tight text-foreground sm:text-display-md">
              {t('listingsHeadline')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              {t('listingsDesc')}
            </p>
          </div>

          {listings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-20 text-center">
              <Rocket className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-4 text-base font-medium text-muted-foreground">
                {t('listingsEmpty')}
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((s) => (
                <StartupCard key={s.id} startup={s} />
              ))}
            </div>
          )}

          {listings.length > 0 && (
            <div className="mt-10 text-center">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-lg px-8 py-4 text-sm font-bold text-white shadow-lg transition-all hover:scale-[1.02]"
                style={{
                  background: 'linear-gradient(135deg, hsl(142,65%,30%) 0%, hsl(142,70%,23%) 100%)',
                }}
              >
                {t('listingsCreate')}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </Container>
      </section>

      {/* ── Final CTA ── */}
      <section
        style={{ background: 'linear-gradient(135deg, hsl(142,80%,9%) 0%, hsl(142,72%,14%) 100%)' }}
        className="py-20 sm:py-28"
      >
        <Container size="md" className="text-center">
          <h2 className="text-display-sm font-display text-white sm:text-display-md">
            {t('ctaHeadline')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-emerald-100/75">
            {t('ctaDesc')}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-lg px-8 py-4 text-sm font-bold text-white shadow-xl transition-all hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, hsl(42,95%,52%) 0%, hsl(36,90%,48%) 100%)',
                boxShadow: '0 4px 24px hsla(42,95%,52%,0.4)',
              }}
            >
              {t('ctaStart')}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-white/5 px-8 py-4 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10"
            >
              {t('ctaContact')}
            </Link>
          </div>
        </Container>
      </section>

    </div>
  );
}
