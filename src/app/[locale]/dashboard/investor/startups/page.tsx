import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StartupMarketplace } from '@/components/features/investor/startup-marketplace';
import { requireRole } from '@/lib/auth-guards';
import { listStartups } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorStartupsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INVESTOR']);

  const [listings, data] = await Promise.all([
    listStartups({ status: 'ACTIVE' }),
    db.read(),
  ]);

  const savedIds = new Set(
    (data.savedStartups ?? [])
      .filter((s) => s.userId === user.id)
      .map((s) => s.startupId),
  );

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('investor.startups.title')}
        subtitle={t('investor.startups.subtitle')}
      />
      {listings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active startup listings yet. Check back soon as founders publish their profiles.
        </p>
      ) : (
        <StartupMarketplace
          startups={listings.map(toStartupDto)}
          savedIds={savedIds}
        />
      )}
    </div>
  );
}
