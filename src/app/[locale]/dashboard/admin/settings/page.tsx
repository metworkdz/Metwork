import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { PlatformSettingsForm } from '@/components/features/admin/platform-settings-form';
import { ConsultantContractTemplateForm } from '@/components/features/admin/consultant-contract-template-form';
import { MetworkLegalForm } from '@/components/features/admin/metwork-legal-form';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';
import { db } from '@/server/db/store';
import { DEFAULT_PLATFORM_SETTINGS } from '@/server/admin/settings-defaults';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function AdminSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const data = await db.read();
  const settings = data.platformSettings ?? DEFAULT_PLATFORM_SETTINGS;
  // Same admin-as-incubator record consultant-contracts/party.ts resolves
  // Metwork's legal identity from — provisioned here too so the fields below
  // always have somewhere to save to, even on a cold account.
  const metworkIncubator = await getOrCreateAdminIncubator(user.id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.settings.title')}
        subtitle={t('admin.settings.subtitle')}
      />
      <PlatformSettingsForm initial={settings} />
      <ConsultantContractTemplateForm initial={settings.consultantContractTemplate ?? null} />
      <MetworkLegalForm
        initial={{
          address: metworkIncubator.address ?? null,
          commercialRegNumber: metworkIncubator.commercialRegNumber ?? null,
          nif: metworkIncubator.nif ?? null,
        }}
      />
      <DeleteAccountSection />
    </div>
  );
}
