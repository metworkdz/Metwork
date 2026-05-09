import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { SubscriptionManager } from '@/components/features/incubator/subscription-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function IncubatorSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

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
