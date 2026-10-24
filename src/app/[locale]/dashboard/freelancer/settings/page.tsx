import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProfileForm } from '@/components/features/entrepreneur/profile-form';
import { CofounderSwitch } from '@/components/features/cofounder/cofounder-switch';
import { db } from '@/server/db/store';
import { profileOf } from '@/server/cofounder/service';
import { DeleteAccountSection } from '@/components/features/settings/delete-account-section';
import { PushToggle } from '@/components/pwa/push-toggle';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function FreelancerSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['FREELANCER']);
  const cofounderEnabled = profileOf(await db.read(), user).enabled;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('freelancer.settings.title')}
        subtitle={t('freelancer.settings.subtitle')}
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
