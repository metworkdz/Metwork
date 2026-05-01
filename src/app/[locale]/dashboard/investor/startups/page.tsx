import { setRequestLocale } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StartupMarketplace } from '@/components/features/investor/startup-marketplace';
import { requireRole } from '@/lib/auth-guards';
import { demoStartups } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorStartupsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INVESTOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Startup marketplace"
        subtitle="Discover Algerian startups that are open to investment."
      />
      <StartupMarketplace startups={demoStartups} />
      <p className="text-xs text-muted-foreground">
        Showing demo data — real listings will appear here once founders publish their profiles.
      </p>
    </div>
  );
}
