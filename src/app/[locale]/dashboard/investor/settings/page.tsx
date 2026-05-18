import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProfileForm } from '@/components/features/entrepreneur/profile-form';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function InvestorSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INVESTOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('investor.settings.title')}
        subtitle={t('investor.settings.subtitle')}
      />
      <ProfileForm
        initial={{
          fullName:  user.fullName,
          city:      user.city,
          locale:    user.locale,
          email:     user.email,
          avatarUrl: user.avatarUrl,
        }}
      />
      <DeleteAccountSection />
    </div>
  );
}
