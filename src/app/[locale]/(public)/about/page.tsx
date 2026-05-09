import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ArrowRight, Target, Users, Zap, MapPin, Mail, Phone, FileText } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { siteConfig } from '@/config/site';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata: Metadata = {
  title: 'About us — Metwork',
  description:
    "Learn about EURL METWORK — the company building Algeria's unified startup ecosystem, connecting entrepreneurs, investors, and incubators.",
};

const VALUES = [
  {
    icon: Target,
    title: 'Mission-driven',
    description:
      'We exist to lower the barriers to entrepreneurship in Algeria. Every feature we build is measured against a simple question: does this help a founder succeed?',
  },
  {
    icon: Users,
    title: 'Community first',
    description:
      'Metwork is only as strong as the people who use it. We invest in the ecosystem — events, programs, mentors — not just the software.',
  },
  {
    icon: Zap,
    title: 'Built in Algeria, for Algeria',
    description:
      "We understand the local landscape. Regulations, culture, language — Metwork is designed from the ground up for the Algerian market, not adapted from abroad.",
  },
];

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-border/60 bg-muted/20">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50/60 via-background to-background"
        />
        <Container>
          <div className="flex flex-col items-center py-20 text-center sm:py-28">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Our story
            </p>
            <h1 className="mt-4 max-w-3xl text-balance font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl">
              Building Algeria&apos;s startup future, together
            </h1>
            <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              Metwork was founded with one goal: to give every Algerian entrepreneur access to
              the tools, capital, and community they need to build something remarkable.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full px-8">
                <Link href="/signup">
                  Join the platform
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-8">
                <Link href="/contact">Get in touch</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Mission ── */}
      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                What we do
              </p>
              <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                One platform for the entire ecosystem
              </h2>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground">
                <p>
                  Algeria has no shortage of talent or ambition — what it lacked was a single,
                  reliable place where founders could discover programs, book coworking spaces,
                  connect with investors, and access mentorship.
                </p>
                <p>
                  Metwork changes that. We bring together entrepreneurs, incubators, investors,
                  and mentors under one roof, making it dramatically easier to find the right
                  people and opportunities at every stage of the startup journey.
                </p>
              </div>
            </div>

            <div className="space-y-0 divide-y divide-border rounded-xl border border-border/60">
              {[
                { value: '500+', label: 'Founders on the platform' },
                { value: '120+', label: 'Active investors' },
                { value: '40+',  label: 'Incubator partners' },
                { value: '15',   label: 'Cities across Algeria' },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-6 px-7 py-5">
                  <span className="min-w-[80px] font-display text-3xl font-bold tracking-tight text-foreground">
                    {stat.value}
                  </span>
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* ── Values ── */}
      <section className="border-y border-border/60 bg-muted/20 py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Our values
            </p>
            <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              What drives us every day
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {VALUES.map(({ icon: Icon, title, description }) => (
              <Card
                key={title}
                className="border-border/60 bg-background transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
              >
                <CardContent className="p-7">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-5 font-display text-base font-semibold tracking-tight text-foreground">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Legal / Company ── */}
      <section className="py-16 sm:py-24">
        <Container size="md">
          <div className="mx-auto max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Legal information
            </p>
            <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Company details
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Metwork is a registered Algerian company. All operations comply with Algerian
              commercial law and the personal data protection framework established by Law 18-07.
            </p>

            <div className="mt-8 rounded-xl border border-border/60 bg-muted/20 p-6 space-y-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Legal name</p>
                  <p className="text-sm text-muted-foreground">EURL METWORK</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Commerce register</p>
                  <p className="text-sm text-muted-foreground">31/00-1125194 B24</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Registered address</p>
                  <p className="text-sm text-muted-foreground">{siteConfig.contact.address}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Email</p>
                  <a
                    href={`mailto:${siteConfig.contact.email}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {siteConfig.contact.email}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Phone</p>
                  <a
                    href={`tel:${siteConfig.contact.phone}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {siteConfig.contact.phone}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-border/60 bg-muted/20 py-16 sm:py-20">
        <Container size="md">
          <div className="text-center">
            <h2 className="text-balance font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Ready to join the ecosystem?
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              Sign up today and connect with Algeria&apos;s fastest-growing startup community.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="rounded-full px-8">
                <Link href="/signup">
                  Get started
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-8">
                <Link href="/programs">Browse programs</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
