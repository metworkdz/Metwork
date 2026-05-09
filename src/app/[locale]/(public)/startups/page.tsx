import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Rocket } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { listStartups } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { getServerSession } from '@/lib/session';
import { ArrowRight, TrendingUp } from 'lucide-react';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.startups');
  return { title: t('title'), description: t('subtitle') };
}

function formatDZD(amount: number): string {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function StartupsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, session, records] = await Promise.all([
    getTranslations('pages.startups'),
    getServerSession(),
    listStartups({ status: 'ACTIVE' }),
  ]);

  const startups = records.map(toStartupDto);

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
                    <Badge variant="default" className="w-fit text-xs font-medium">
                      {startup.industry}
                    </Badge>

                    <h3 className="mt-3 line-clamp-1 text-lg font-semibold tracking-tight text-foreground">
                      {startup.name}
                    </h3>
                    <p className="mt-2 flex-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {startup.description}
                    </p>

                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Funding goal</p>
                        <p className="mt-0.5 text-sm font-semibold text-foreground">
                          {formatDZD(startup.fundingGoal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Equity</p>
                        <p className="mt-0.5 text-sm font-semibold text-foreground">
                          {startup.equityOffered}%
                        </p>
                      </div>
                    </div>

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
