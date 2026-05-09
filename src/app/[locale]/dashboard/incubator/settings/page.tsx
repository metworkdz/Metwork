import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { SubscriptionManager } from '@/components/features/incubator/subscription-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function IncubatorSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);

  if (!incubator) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title={t('incubator.settings.title')}
          subtitle={t('incubator.settings.subtitleNoProfile')}
        />
        <p className="text-sm text-muted-foreground">
          Your incubator profile is being set up. Please contact support if this persists.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Settings"
        subtitle="Manage your subscription plan and billing preferences."
      />
      <SubscriptionManager />
    </div>
  );
}
