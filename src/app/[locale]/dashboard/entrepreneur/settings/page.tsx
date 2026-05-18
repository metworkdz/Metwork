import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProfileForm } from '@/components/features/entrepreneur/profile-form';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';

export const metadata = { title: 'Settings' };

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ENTREPRENEUR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.settings.title')}
        subtitle={t('entrepreneur.settings.subtitle')}
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
