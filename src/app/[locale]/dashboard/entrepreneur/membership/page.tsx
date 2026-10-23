import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { MembershipPageContent } from '@/components/features/membership/membership-page';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurMembershipPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ENTREPRENEUR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.membership.title')}
        subtitle={t('entrepreneur.membership.subtitle')}
      />
      <MembershipPageContent
        audience="ENTREPRENEUR"
        user={user}
        locale={locale as Locale}
        walletHref="/dashboard/entrepreneur/wallet"
      />
    </div>
  );
}
