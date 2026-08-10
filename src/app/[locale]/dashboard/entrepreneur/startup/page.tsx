import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StartupProfileForm } from '@/components/features/startup/startup-profile-form';
import { listStartups } from '@/server/startups/service';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurStartupPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ENTREPRENEUR']);

  // Load the founder's existing listing (at most one active/draft per founder).
  const listings = await listStartups({ founderId: user.id });
  const existing = listings[0] ?? null;

  const initial = existing
    ? {
        id:            existing.id,
        name:          existing.name,
        description:   existing.description,
        industry:      existing.industry,
        fundingGoal:   String(existing.fundingGoal),
        equityOffered: String(existing.equityOffered),
        valuation:     existing.valuation ? String(existing.valuation) : '',
        maturityStage: existing.maturityStage ?? null,
        pitchDeckUrl:  existing.pitchDeckUrl ?? null,
        websiteUrl:    existing.websiteUrl ?? '',
        status:        existing.status,
      }
    : {
        id:            null,
        name:          '',
        description:   '',
        industry:      'SaaS',
        fundingGoal:   '',
        equityOffered: '',
        valuation:     '',
        maturityStage: null,
        pitchDeckUrl:  null,
        websiteUrl:    '',
        status:        'DRAFT' as const,
      };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.startup.title')}
        subtitle={t('entrepreneur.startup.subtitle')}
      />
      <StartupProfileForm initial={initial} />
    </div>
  );
}
