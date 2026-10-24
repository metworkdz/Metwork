import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProfileForm } from '@/components/features/entrepreneur/profile-form';
import { CofounderSwitch } from '@/components/features/cofounder/cofounder-switch';
import { db } from '@/server/db/store';
import { profileOf } from '@/server/cofounder/service';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';
import { PushToggle } from '@/components/pwa/push-toggle';

export const metadata = { title: 'Settings' };

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ENTREPRENEUR']);
  const cofounderEnabled = profileOf(await db.read(), user).enabled;

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
      <CofounderSwitch initial={cofounderEnabled} />
      <PushToggle />
      <DeleteAccountSection />
    </div>
  );
}
