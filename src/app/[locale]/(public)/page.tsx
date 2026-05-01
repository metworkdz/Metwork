import { setRequestLocale } from 'next-intl/server';
import { ArrowRight, Briefcase, Building2, TrendingUp, Users } from 'lucide-react';
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
  const content = await getLandingContent();

  return (
    <>
      <Hero hero={content.hero} />
      <About />
      <Stats stats={content.stats} />
      <Features features={content.features} />
      <RoleSection roles={content.roles} />
      <LandingMentorsSection />
      <CTASection cta={content.cta} />
    </>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */

function Hero({ hero }: { hero: LandingContent['hero'] }) {
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

          {/* Title — display font, uppercase */}
          <h1 className="mt-6 max-w-5xl font-display text-4xl font-bold uppercase leading-[1.08] tracking-tight text-foreground sm:mt-8 sm:text-5xl md:text-7xl lg:text-[5.5rem]">
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
          <p className="mt-8 text-xs text-muted-foreground/60">
            Trusted by founders, investors, and incubators across Algeria.
          </p>
        </div>
      </Container>
    </section>
  );
}

/* ─────────────────────────── About ─────────────────────────── */

const pillars = [
  {
    num: '01',
    title: 'Incubate',
    desc: 'Hands-on programs, coworking space, and expert mentorship for early-stage Algerian startups.',
  },
  {
    num: '02',
    title: 'Connect',
    desc: 'A curated network bridging founders with investors, mentors, and incubators across the country.',
  },
  {
    num: '03',
    title: 'Scale',
    desc: 'Tools and partnerships to help Algerian startups grow beyond local markets and reach new frontiers.',
  },
] as const;

function About() {
  return (
    <section className="py-14 sm:py-24">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-24 xl:gap-32">

          {/* Left — text block */}
          <div>
            <p className="section-label">About Metwork</p>
            <h2 className="mt-4 max-w-lg font-display text-3xl font-bold uppercase leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              Algeria&apos;s startup incubator, based in Oran.
            </h2>
            <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground">
              <p>
                Metwork is a startup incubator headquartered in Oran, Algeria. We were built
                with one goal in mind: unite the people and organisations driving Algeria&apos;s
                next economic transformation under a single, powerful platform.
              </p>
              <p>
                We believe Algeria&apos;s next wave of great companies will not be built in
                isolation. They will be built through connection — the right mentors, the right
                capital, and the right community, all in the same room.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="mt-8 rounded-full px-8 text-sm font-semibold"
            >
              <Link href="/contact">
                Work with us
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
                  <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
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

function Features({ features }: { features: LandingContent['features'] }) {
  return (
    <section className="py-14 sm:py-24">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-label">What we offer</p>
          <h2 className="mt-4 font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl lg:text-5xl">
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
                  <h3 className="mt-5 font-display text-base font-bold uppercase tracking-wide text-foreground">
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

function RoleSection({ roles }: { roles: LandingContent['roles'] }) {
  return (
    <section className="border-t border-border/60 bg-muted/25 py-14 sm:py-24">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <p className="section-label">Who we serve</p>
          <h2 className="mt-4 font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl lg:text-5xl">
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
                <h3 className="font-display text-xl font-bold uppercase tracking-wide text-foreground">
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
                    Get started
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

function CTASection({ cta }: { cta: LandingContent['cta'] }) {
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
              Join the movement
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold uppercase leading-tight tracking-tight text-white sm:text-4xl md:text-5xl lg:text-6xl">
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
                <Link href="/programs">Explore programs</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
