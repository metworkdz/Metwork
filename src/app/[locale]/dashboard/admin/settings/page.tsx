import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { PlatformSettingsForm } from '@/components/features/admin/platform-settings-form';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';
import { db } from '@/server/db/store';
import { DEFAULT_PLATFORM_SETTINGS } from '@/server/admin/settings-defaults';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function AdminSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const settings = data.platformSettings ?? DEFAULT_PLATFORM_SETTINGS;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.settings.title')}
        subtitle={t('admin.settings.subtitle')}
      />
      <PlatformSettingsForm initial={settings} />
      <DeleteAccountSection />
    </div>
  );
}
