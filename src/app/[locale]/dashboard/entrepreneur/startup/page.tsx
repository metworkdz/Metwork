import { setRequestLocale } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StartupProfileForm } from '@/components/features/startup/startup-profile-form';
import { requireRole } from '@/lib/auth-guards';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurStartupPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['ENTREPRENEUR']);

  // Demo defaults — replace with `await startupService.getMine()` when the
  // startups resource ships.
  const initial = {
    name: '',
    tagline: '',
    pitch: '',
    stage: 'IDEA' as const,
    sector: 'AI / Media',
    city: user.city,
    fundingAsk: '',
    isListed: false,
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Startup profile"
        subtitle="What investors browsing the marketplace will see."
      />
      <StartupProfileForm initial={initial} />
    </div>
  );
}
