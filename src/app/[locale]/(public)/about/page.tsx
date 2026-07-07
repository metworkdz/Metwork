import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, Target, Users, Zap, MapPin, Mail, Phone, FileText } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { siteConfig } from '@/config/site';
import { assertLandingVisible } from '@/lib/landing-visibility';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('about');
  return {
    title: 'About us — Metwork',
    description:
      "Learn about EURL METWORK — the company building Algeria's unified startup ecosystem, connecting entrepreneurs, investors, and incubators.",
  };
}

const VALUE_ICONS = [Target, Users, Zap] as const;

const STATS = [
  { value: '500+', key: 'stat1' },
  { value: '120+', key: 'stat2' },
  { value: '40+',  key: 'stat3' },
  { value: '15',   key: 'stat4' },
] as const;

export default async function AboutPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('about');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.about');

  const values = [
    { icon: VALUE_ICONS[0], title: t('value1Title'), description: t('value1Desc') },
    { icon: VALUE_ICONS[1], title: t('value2Title'), description: t('value2Desc') },
    { icon: VALUE_ICONS[2], title: t('value3Title'), description: t('value3Desc') },
  ];

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
              {t('heroEyebrow')}
            </p>
            <h1 className="mt-4 max-w-3xl text-balance font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl">
              {t('heroHeadline')}
            </h1>
            <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t('heroSubheadline')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full px-8">
                <Link href="/signup">
                  {t('heroJoin')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-8">
                <Link href="/contact">{t('heroContact')}</Link>
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
                {t('missionEyebrow')}
              </p>
              <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                {t('missionHeadline')}
              </h2>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground">
                <p>{t('missionP1')}</p>
                <p>{t('missionP2')}</p>
              </div>
            </div>

            <div className="space-y-0 divide-y divide-border rounded-xl border border-border/60">
              {STATS.map((stat) => (
                <div key={stat.key} className="flex items-center gap-6 px-7 py-5">
                  <span className="min-w-[80px] font-display text-3xl font-bold tracking-tight text-foreground">
                    {stat.value}
                  </span>
                  <span className="text-sm text-muted-foreground">{t(stat.key)}</span>
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
              {t('valuesEyebrow')}
            </p>
            <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('valuesHeadline')}
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {values.map(({ icon: Icon, title, description }) => (
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
              {t('legalEyebrow')}
            </p>
            <h2 className="mt-4 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('legalHeadline')}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t('legalDesc')}
            </p>

            <div className="mt-8 rounded-xl border border-border/60 bg-muted/20 p-6 space-y-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('legalName')}</p>
                  <p className="text-sm text-muted-foreground">EURL METWORK</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('legalRegister')}</p>
                  <p className="text-sm text-muted-foreground">31/00-1125194 B24</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('legalAddress')}</p>
                  <p className="text-sm text-muted-foreground">{siteConfig.contact.address}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('legalEmail')}</p>
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
                  <p className="text-sm font-semibold text-foreground">{t('legalPhone')}</p>
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
              {t('ctaHeadline')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              {t('ctaDesc')}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="rounded-full px-8">
                <Link href="/signup">
                  {t('ctaStart')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-8">
                <Link href="/programs">{t('ctaBrowse')}</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
