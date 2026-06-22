import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { IncubatorProfileForm } from '@/components/features/incubator/incubator-profile-form';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function BusinessSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.business.settings');
  const user = await requireRole(['BUSINESS']);

  const data = await db.read();
  const provider = data.incubators.find((i) => i.managerId === user.id);

  if (!provider) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader title={t('title')} subtitle={t('subtitleNoProfile')} />
        <p className="text-sm text-muted-foreground">{t('settingUp')}</p>
        <DeleteAccountSection />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      {/* Businesses are commission-only — hide the subscription / billing section. */}
      <IncubatorProfileForm
        incubator={provider}
        user={{ id: user.id, fullName: user.fullName, email: user.email, avatarUrl: user.avatarUrl }}
        showSubscriptionTier={false}
      />
      <DeleteAccountSection />
    </div>
  );
}
