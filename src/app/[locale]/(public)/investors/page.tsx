import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TrendingUp } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { StartupCard } from '@/components/features/startups/startup-card';
import { listStartups } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.investors');
  return { title: t('title'), description: t('subtitle') };
}

export default async function InvestorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.investors');

  const listings = (await listStartups({ status: 'ACTIVE' })).map(toStartupDto);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {listings.length === 0 ? (
        <EmptyState
          message={t('empty')}
          icon={<TrendingUp className="size-6 text-muted-foreground" />}
        />
      ) : (
        <section className="py-10 sm:py-14">
          <Container>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((s) => (
                <StartupCard key={s.id} startup={s} />
              ))}
            </div>
          </Container>
        </section>
      )}
    </>
  );
}
