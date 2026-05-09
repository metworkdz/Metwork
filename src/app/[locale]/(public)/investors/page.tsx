import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
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

export const metadata: Metadata = {
  title: 'Invest in Algeria — Metwork',
  description:
    'Discover high-potential Algerian startups. Connect with founders, review opportunities, and invest in the next generation of African tech.',
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

const STATS = [
  { value: '47M+', label: 'Population' },
  { value: '$220B', label: 'GDP' },
  { value: '68%', label: 'Under 30' },
  { value: '3×', label: 'Startup growth (3Y)' },
];

const REASONS = [
  {
    icon: Globe,
    title: 'Africa\'s largest country',
    description:
      'Algeria is the largest country in Africa and the Arab world, with a domestic market of 47 million consumers and deep ties to European and African export markets.',
  },
  {
    icon: Users,
    title: 'Young, digital-native talent',
    description:
      '68% of Algeria\'s population is under 30. A fast-growing university system produces 300,000+ engineering and tech graduates each year, ready to build.',
  },
  {
    icon: TrendingUp,
    title: 'Emerging startup ecosystem',
    description:
      'Government incentives, new startup laws, and rising angel activity have tripled the number of registered startups in three years — still early for serious upside.',
  },
  {
    icon: ShieldCheck,
    title: 'Supportive legal framework',
    description:
      'The 2020 Startup Act offers tax exemptions, equity protection, and accelerated business creation for recognized startups and their investors.',
  },
  {
    icon: BarChart3,
    title: 'Underserved, high-margin sectors',
    description:
      'FinTech, logistics, HealthTech, and AgriTech remain massively underserved. First-mover advantage is still available in categories that have matured elsewhere.',
  },
  {
    icon: Building2,
    title: 'Growing incubator network',
    description:
      'A national network of incubators and accelerators provides deal flow, co-investment partners, and on-the-ground due diligence support for international investors.',
  },
];

const STEPS = [
  {
    step: '01',
    title: 'Browse listings',
    description: 'Filter active startup profiles by industry, funding goal, and equity offered.',
  },
  {
    step: '02',
    title: 'Send a request',
    description: 'Click "Contact founder" on any listing. Our team reviews and connects you directly.',
  },
  {
    step: '03',
    title: 'Track your deals',
    description: 'Log meetings, term sheets, and closed rounds in your personal investment tracker.',
  },
];

export default async function InvestorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const listings = (await listStartups({ status: 'ACTIVE' })).map(toStartupDto);

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
                Investment opportunities in Algeria
              </span>
            </div>

            <h1 className="text-balance font-display text-display-lg text-white sm:text-display-xl">
              Invest in the future of{' '}
              <span
                className="relative"
                style={{
                  WebkitTextFillColor: 'transparent',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  backgroundImage: 'linear-gradient(90deg,hsl(45,95%,60%),hsl(38,90%,70%))',
                }}
              >
                African tech
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-emerald-100/80">
              Algeria's startup ecosystem is growing at a record pace. High-potential founders.
              Underserved markets. Real upside. Metwork connects you directly.
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
                Contact us
                <ArrowRight className="size-4" />
              </Link>

              {/* Secondary outline */}
              <Link
                href="#listings"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              >
                Explore projects
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
              {STATS.map(({ value, label }) => (
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
              Why Algeria
            </p>
            <h2 className="mt-3 text-display-sm font-display tracking-tight text-foreground sm:text-display-md">
              The opportunity most investors are missing
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              While attention focuses on West African and North-African coastal markets, Algeria's
              combination of scale, talent density, and digital gap creates a compelling
              risk-adjusted investment case.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {REASONS.map(({ icon: Icon, title, description }) => (
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
              How it works
            </p>
            <h2 className="mt-3 text-display-sm font-display tracking-tight text-foreground sm:text-display-md">
              From discovery to deal in three steps
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {STEPS.map(({ step, title, description }) => (
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
              Start investing
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-7 py-3.5 text-sm font-semibold text-primary-700 shadow-sm transition-all hover:bg-primary-50"
            >
              Talk to our team
            </Link>
          </div>
        </Container>
      </section>

      {/* ── Active listings ── */}
      <section id="listings" className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-10">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              Live on Metwork
            </p>
            <h2 className="mt-3 text-display-sm font-display tracking-tight text-foreground sm:text-display-md">
              Startups raising right now
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              All listings are verified by the Metwork team. Create an investor account to
              contact founders directly.
            </p>
          </div>

          {listings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-20 text-center">
              <Rocket className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-4 text-base font-medium text-muted-foreground">
                No active listings yet — check back soon.
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
                Create your investor account
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
            Ready to invest in Algeria?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-emerald-100/75">
            Join a growing community of investors, angels, and family offices discovering
            Algeria's next generation of founders on Metwork.
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
              Get started — it&apos;s free
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-white/5 px-8 py-4 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10"
            >
              Contact us
            </Link>
          </div>
        </Container>
      </section>

    </div>
  );
}
