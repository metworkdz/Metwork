import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, Briefcase, Building2, TrendingUp, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { LandingMentorsSection } from '@/components/features/mentors/landing-mentors-section';
import { getLandingContent } from '@/server/cms/service';
import { cn } from '@/lib/utils';
import type { LandingContent } from '@/types/cms';
import type { LucideIcon } from 'lucide-react';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function LandingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [saved, t] = await Promise.all([
    getLandingContent(),
    getTranslations('landing'),
  ]);

  // Always use locale translations for all text so fr/ar visitors see the
  // correct language. CMS saved values are only respected for the numeric
  // stats figures (e.g. "500+") since those are admin-maintained numbers
  // that don't require translation.
  const content: LandingContent = {
    hero: {
      badge:        t('hero.badge'),
      title:        t('hero.title'),
      subtitle:     t('hero.subtitle'),
      ctaPrimary:   t('hero.ctaPrimary'),
      ctaSecondary: t('hero.ctaSecondary'),
    },
    stats: {
      founders:   { value: saved?.stats.founders.value   ?? '500+', label: t('stats.founders') },
      investors:  { value: saved?.stats.investors.value  ?? '120+', label: t('stats.investors') },
      incubators: { value: saved?.stats.incubators.value ?? '40+',  label: t('stats.incubators') },
      cities:     { value: saved?.stats.cities.value     ?? '15',   label: t('stats.cities') },
    },
    features: {
      title:    t('features.title'),
      subtitle: t('features.subtitle'),
      items: [
        { key: 'programs',    title: t('features.programs.title'),    description: t('features.programs.description') },
        { key: 'spaces',      title: t('features.spaces.title'),      description: t('features.spaces.description') },
        { key: 'fundraising', title: t('features.fundraising.title'), description: t('features.fundraising.description') },
        { key: 'community',   title: t('features.community.title'),   description: t('features.community.description') },
      ],
    },
    roles: {
      title: t('roles.title'),
      items: [
        { key: 'entrepreneur', title: t('roles.entrepreneur.title'), description: t('roles.entrepreneur.description') },
        { key: 'investor',     title: t('roles.investor.title'),     description: t('roles.investor.description') },
        { key: 'incubator',    title: t('roles.incubator.title'),    description: t('roles.incubator.description') },
      ],
    },
    cta: {
      title:    t('cta.title'),
      subtitle: t('cta.subtitle'),
      button:   t('cta.button'),
    },
    updatedAt: saved?.updatedAt ?? new Date(0).toISOString(),
  };

  const about = {
    label:       t('about.label'),
    title:       t('about.title'),
    body1:       t('about.body1'),
    body2:       t('about.body2'),
    cta:         t('about.cta'),
    pillar1Title: t('about.pillar1Title'),
    pillar1Desc:  t('about.pillar1Desc'),
    pillar2Title: t('about.pillar2Title'),
    pillar2Desc:  t('about.pillar2Desc'),
    pillar3Title: t('about.pillar3Title'),
    pillar3Desc:  t('about.pillar3Desc'),
  };

  const sections = {
    whatWeOffer:     t('sections.whatWeOffer'),
    whoWeServe:      t('sections.whoWeServe'),
    joinMovement:    t('sections.joinMovement'),
    socialProof:     t('socialProof'),
    explorePrograms: t('cta.explorePrograms'),
    getStarted:      t('hero.ctaPrimary'),
  };

  return (
    <>
      <Hero hero={content.hero} socialProof={sections.socialProof} />
      <About about={about} />
      <Stats stats={content.stats} />
      <Features features={content.features} sectionLabel={sections.whatWeOffer} />
      <RoleSection
        roles={content.roles}
        sectionLabel={sections.whoWeServe}
        getStarted={sections.getStarted}
      />
      <LandingMentorsSection />
      <CTASection
        cta={content.cta}
        sectionLabel={sections.joinMovement}
        explorePrograms={sections.explorePrograms}
      />
    </>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */

function Hero({
  hero,
  socialProof,
}: {
  hero: LandingContent['hero'];
  socialProof: string;
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50/80 via-background to-background"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[500px] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,_var(--tw-gradient-stops))] from-primary-100/70 via-primary-50/20 to-transparent"
      />

      <Container>
        <div className="flex flex-col items-center pb-14 pt-12 text-center sm:pb-24 sm:pt-20">

          {/* Badge */}
          <div className="inline-flex items-center gap-2.5 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-primary-700">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary-600" />
            </span>
            {hero.badge}
          </div>

          {/* Title */}
          <h1 className="mt-6 max-w-4xl text-balance font-display text-4xl font-semibold tracking-tight text-foreground sm:mt-8 sm:text-5xl md:text-6xl lg:text-7xl">
            {hero.title}
          </h1>

          {/* Subtitle */}
          <p className="mt-7 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            {hero.subtitle}
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              asChild
              size="lg"
              className="group rounded-full px-8 text-sm font-bold uppercase tracking-wider shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              <Link href="/signup">
                {hero.ctaPrimary}
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full px-8 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5"
            >
              <Link href="/programs">{hero.ctaSecondary}</Link>
            </Button>
          </div>

          {/* Social proof line */}
          <p className="mt-8 text-xs text-muted-foreground/60">{socialProof}</p>
        </div>
      </Container>
    </section>
  );
}

/* ─────────────────────────── About ─────────────────────────── */

type AboutLabels = {
  label: string;
  title: string;
  body1: string;
  body2: string;
  cta: string;
  pillar1Title: string;
  pillar1Desc: string;
  pillar2Title: string;
  pillar2Desc: string;
  pillar3Title: string;
  pillar3Desc: string;
};

function About({ about }: { about: AboutLabels }) {
  const pillars = [
    { num: '01', title: about.pillar1Title, desc: about.pillar1Desc },
    { num: '02', title: about.pillar2Title, desc: about.pillar2Desc },
    { num: '03', title: about.pillar3Title, desc: about.pillar3Desc },
  ];

  return (
    <section className="py-14 sm:py-24">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-24 xl:gap-32">

          {/* Left — text block */}
          <div>
            <p className="section-label">{about.label}</p>
            <h2 className="mt-4 max-w-lg text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              {about.title}
            </h2>
            <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground">
              <p>{about.body1}</p>
              <p>{about.body2}</p>
            </div>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="mt-8 rounded-full px-8 text-sm font-semibold"
            >
              <Link href="/contact">
                {about.cta}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          </div>

          {/* Right — numbered pillars */}
          <div className="space-y-0 divide-y divide-border">
            {pillars.map((p) => (
              <div key={p.num} className="flex gap-6 py-7 first:pt-0 last:pb-0">
                <span className="mt-0.5 shrink-0 font-display text-xs font-bold text-primary-400">
                  {p.num}
                </span>
                <div>
                  <p className="font-display text-sm font-semibold tracking-tight text-foreground">
                    {p.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ─────────────────────────── Stats ─────────────────────────── */

function Stats({ stats }: { stats: LandingContent['stats'] }) {
  const items = [stats.founders, stats.investors, stats.incubators, stats.cities];

  return (
    <section className="border-y border-border/60 bg-muted/25 py-10 sm:py-14">
      <Container>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          {items.map((stat, i) => (
            <div key={i} className="text-center">
              <dd className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                {stat.value}
              </dd>
              <dt className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {stat.label}
              </dt>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

/* ─────────────────────────── Features ─────────────────────────── */

const featureIcons: Record<string, LucideIcon> = {
  programs:    Briefcase,
  spaces:      Building2,
  fundraising: TrendingUp,
  community:   Users,
};

function Features({
  features,
  sectionLabel,
}: {
  features: LandingContent['features'];
  sectionLabel: string;
}) {
  return (
    <section className="py-14 sm:py-24">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-label">{sectionLabel}</p>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            {features.title}
          </h2>
          <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">
            {features.subtitle}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-16 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.items.map((f) => {
            const Icon = featureIcons[f.key] ?? Briefcase;
            return (
              <Card
                key={f.key}
                className="group border-border/60 bg-background transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-lg hover:shadow-primary/5"
              >
                <CardContent className="p-7">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 transition-colors duration-300 group-hover:bg-primary-100">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-5 font-display text-base font-semibold tracking-tight text-foreground">
                    {f.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                    {f.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

/* ─────────────────────────── Roles ─────────────────────────── */

const roleAccents: Record<string, string> = {
  entrepreneur: 'from-primary-500 to-primary-700',
  investor:     'from-emerald-500 to-teal-700',
  incubator:    'from-amber-500 to-orange-600',
};

function RoleSection({
  roles,
  sectionLabel,
  getStarted,
}: {
  roles: LandingContent['roles'];
  sectionLabel: string;
  getStarted: string;
}) {
  return (
    <section className="border-t border-border/60 bg-muted/25 py-14 sm:py-24">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-label">{sectionLabel}</p>
          <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            {roles.title}
          </h2>
        </div>

        <div className="mt-10 grid gap-5 sm:mt-14 md:grid-cols-3">
          {roles.items.map((role) => (
            <Card
              key={role.key}
              className="group relative overflow-hidden border-border/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-foreground/5"
            >
              {/* Top accent bar */}
              <div
                aria-hidden
                className={cn(
                  'absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r',
                  roleAccents[role.key] ?? 'from-primary-500 to-primary-700',
                )}
              />
              <CardContent className="p-8 pt-9">
                <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                  {role.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {role.description}
                </p>
                <div className="mt-6">
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:text-primary-700"
                  >
                    {getStarted}
                    <ArrowRight className="size-3 rtl:rotate-180" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─────────────────────────── CTA ─────────────────────────── */

function CTASection({
  cta,
  sectionLabel,
  explorePrograms,
}: {
  cta: LandingContent['cta'];
  sectionLabel: string;
  explorePrograms: string;
}) {
  return (
    <section className="py-14 sm:py-24">
      <Container size="lg">
        <div className="relative overflow-hidden rounded-2xl bg-foreground px-5 py-12 text-center sm:rounded-3xl sm:px-12 sm:py-20 lg:px-16 lg:py-28">
          {/* Subtle green tint radial */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(142_65%_30%_/_0.35),_transparent_60%)]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_hsl(142_65%_30%_/_0.2),_transparent_60%)]"
          />

          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-400">
              {sectionLabel}
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl text-balance font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-5xl lg:text-6xl">
              {cta.title}
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-balance text-base text-white/60">
              {cta.subtitle}
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button
                asChild
                size="xl"
                className="rounded-full bg-primary px-10 text-sm font-bold uppercase tracking-wider shadow-lg shadow-primary/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/40 transition-all duration-200"
              >
                <Link href="/signup">
                  {cta.button}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button
                asChild
                size="xl"
                variant="outline"
                className="rounded-full border-white/20 bg-transparent px-10 text-sm font-semibold text-white hover:bg-white/10 hover:-translate-y-0.5 transition-all duration-200"
              >
                <Link href="/programs">{explorePrograms}</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
