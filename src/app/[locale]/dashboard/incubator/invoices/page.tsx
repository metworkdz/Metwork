import { setRequestLocale } from 'next-intl/server';
import { Clock } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EmptyState } from '@/components/shared/empty-state';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Invoices' };

export default async function IncubatorInvoicesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Invoices"
        subtitle="Download and manage invoices for bookings and memberships."
      />
      <EmptyState
        icon={<Clock className="size-6 text-muted-foreground" />}
        message="This section is coming soon. We're working on it."
      />
    </div>
  );
}
