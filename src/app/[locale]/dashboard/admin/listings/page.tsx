import { setRequestLocale } from 'next-intl/server';
import { ClipboardCheck } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { ListingsApprovalTable } from '@/components/features/admin/listings-approval-table';
import { requireRole } from '@/lib/auth-guards';
import { demoPendingListings } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminListingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Pending listings"
        subtitle="Spaces, programs, and events awaiting platform approval."
        action={
          <Badge variant="warning" className="gap-1">
            <ClipboardCheck className="size-3" />
            {demoPendingListings.length} waiting
          </Badge>
        }
      />
      <ListingsApprovalTable initial={demoPendingListings} />
      <p className="text-xs text-muted-foreground">
        Showing demo data — approve / reject actions are stubbed until the admin listings API ships.
      </p>
    </div>
  );
}
