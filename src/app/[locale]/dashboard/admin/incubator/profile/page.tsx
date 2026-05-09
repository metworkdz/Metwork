import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { IncubatorProfileForm } from '@/components/features/incubator/incubator-profile-form';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Incubator Profile' };

export default async function AdminIncubatorProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const incubator = await getOrCreateAdminIncubator(user.id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubator.profile.title')}
        subtitle={t('admin.incubator.profile.subtitle')}
      />
      <IncubatorProfileForm
        incubator={incubator}
        user={{
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          avatarUrl: user.avatarUrl,
        }}
      />
    </div>
  );
}
