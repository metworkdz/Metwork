import { setRequestLocale } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { MeetingRequestsList } from '@/components/features/investor/meeting-requests-list';
import { requireRole } from '@/lib/auth-guards';
import { demoMeetingRequests } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorMeetingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INVESTOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Meeting requests"
        subtitle="Founders you've reached out to and inbound requests."
      />
      <MeetingRequestsList initial={demoMeetingRequests} />
      <p className="text-xs text-muted-foreground">
        Showing demo data — accept/decline are stubbed until the meetings API ships.
      </p>
    </div>
  );
}
