import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { MembershipPageContent } from '@/components/features/membership/membership-page';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FreelancerMembershipPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['FREELANCER']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('freelancer.membership.title')}
        subtitle={t('freelancer.membership.subtitle')}
      />
      <MembershipPageContent
        audience="FREELANCER"
        user={user}
        locale={locale as Locale}
        walletHref="/dashboard/freelancer/wallet"
      />
    </div>
  );
}
