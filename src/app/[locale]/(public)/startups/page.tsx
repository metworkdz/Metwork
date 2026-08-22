import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, Rocket, TrendingUp } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { LockedNotice } from '@/components/features/startups/locked-notice';
import { StartupLogo } from '@/components/shared/startup-logo';
import { listStartups } from '@/server/startups/service';
import { toPublicStartupDto } from '@/server/startups/serialize';
import { getServerSession } from '@/lib/session';
import { assertLandingVisible } from '@/lib/landing-visibility';
import { db } from '@/server/db/store';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('startups');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.startups');
  return { title: t('title'), description: t('subtitle') };
}

export default async function StartupsPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('startups');
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tStage, session, records, data] = await Promise.all([
    getTranslations('pages.startups'),
    getTranslations('startup.profileForm'),
    getServerSession(),
    listStartups({ status: 'ACTIVE' }),
    db.read(),
  ]);

  const cityByFounderId = new Map(data.users.map((u) => [u.id, u.city]));
  const startups = records.map((r) =>
    toPublicStartupDto(r, { city: cityByFounderId.get(r.founderId) ?? null }),
  );

  // Collect unique industries for the filter facets
  const industries = Array.from(new Set(startups.map((s) => s.industry))).sort();

  const isInvestor = session?.role === 'INVESTOR';

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-primary-50/60 to-background">
        <Container>
          <div className="flex flex-col items-center py-14 text-center sm:py-20">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
              <Rocket className="size-6" />
            </div>
            <h1 className="mt-5 font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl lg:text-5xl">
              {t('title')}
            </h1>
            <p className="mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
              {t('subtitle')}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground">{startups.length}</span>
                startups listed
              </span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground">{industries.length}</span>
                industries
              </span>
            </div>
          </div>
        </Container>
      </section>

      {/* Startup grid */}
      <section className="py-10 sm:py-14">
        <Container>
          {/* Industry filter pills */}
          {industries.length > 0 && (
            <div className="mb-8 flex flex-wrap gap-2">
              <Badge variant="default" className="cursor-pointer text-xs">
                {t('filterAll')}
              </Badge>
              {industries.map((ind) => (
                <Badge key={ind} variant="outline" className="cursor-pointer text-xs">
                  {ind}
                </Badge>
              ))}
            </div>
          )}

          {startups.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Rocket className="size-7" />
              </div>
              <p className="text-base text-muted-foreground">{t('empty')}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {startups.map((startup) => (
                <Card
                  key={startup.id}
                  className="flex flex-col border-border/60 transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md"
                >
                  <CardContent className="flex flex-1 flex-col p-6">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="default" className="w-fit text-xs font-medium">
                        {startup.industry}
                      </Badge>
                      {startup.maturityStage && (
                        <Badge variant="outline" className="w-fit text-xs font-medium">
                          {tStage(`stage${startup.maturityStage}`)}
                        </Badge>
                      )}
                      {startup.isRaising && (
                        <Badge variant="success" className="w-fit text-xs font-medium">
                          {t('raisingBadge')}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <StartupLogo logoUrl={startup.logoUrl} name={startup.name} size={36} />
                      <h3 className="line-clamp-1 text-lg font-semibold tracking-tight text-foreground">
                        {startup.name}
                      </h3>
                    </div>
                    {startup.city && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{startup.city}</p>
                    )}
                    <p className="mt-2 flex-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {startup.tagline}
                    </p>

                    <LockedNotice
                      label={t('lockedLabel')}
                      cta={t('lockedCta')}
                      compact
                      className="mt-5"
                    />

                    {isInvestor && (
                      <Link
                        href={`/investors/${startup.id}`}
                        className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                      >
                        View details
                        <ArrowRight className="size-3 rtl:rotate-180" />
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Container>
      </section>

      {/* Investor CTA (shown to non-investors) */}
      {!isInvestor && (
        <section className="border-t border-border/60 bg-muted/25 py-14">
          <Container size="sm">
            <div className="flex flex-col items-center text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
                <TrendingUp className="size-6" />
              </div>
              <h2 className="mt-5 font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
                {t('cta')}
              </h2>
              <p className="mt-3 max-w-md text-base text-muted-foreground">{t('ctaSub')}</p>
              <Button
                asChild
                size="lg"
                className="mt-8 rounded-full px-8 text-sm font-bold uppercase tracking-wider"
              >
                <Link href="/signup">
                  {t('ctaButton')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
            </div>
          </Container>
        </section>
      )}
    </>
  );
}
