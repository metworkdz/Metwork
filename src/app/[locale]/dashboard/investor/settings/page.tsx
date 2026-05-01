import { setRequestLocale } from 'next-intl/server';
import { Clock } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EmptyState } from '@/components/shared/empty-state';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Settings' };

export default async function InvestorSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INVESTOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Settings"
        subtitle="Manage your account preferences and notification settings."
      />
      <EmptyState
        icon={<Clock className="size-6 text-muted-foreground" />}
        message="This section is coming soon. We're working on it."
      />
    </div>
  );
}
