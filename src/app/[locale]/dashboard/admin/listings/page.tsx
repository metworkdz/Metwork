import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ClipboardCheck } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { ListingsApprovalTable } from '@/components/features/admin/listings-approval-table';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import type { PendingListingRow } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminListingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  // Surface unpublished incubator content as "pending" listings.
  const data = await db.read();
  const rows: PendingListingRow[] = [
    ...(data.spaces ?? [])
      .filter((s) => !s.isActive)
      .map((s) => ({
        id: s.id,
        kind: 'SPACE' as const,
        title: s.name,
        incubator: s.incubatorName,
        city: s.city,
        price: s.pricePerDay ?? s.pricePerHour ?? s.pricePerMonth ?? 0,
        submittedAt: s.createdAt,
      })),
    ...(data.programs ?? [])
      .filter((p) => !p.isActive)
      .map((p) => ({
        id: p.id,
        kind: 'PROGRAM' as const,
        title: p.title,
        incubator: p.incubatorName,
        city: p.city,
        price: p.price,
        submittedAt: p.createdAt,
      })),
  ].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.listings.title')}
        subtitle={t('admin.listings.subtitle')}
        action={
          rows.length > 0 ? (
            <Badge variant="warning" className="gap-1">
              <ClipboardCheck className="size-3" />
              {rows.length} waiting
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <ClipboardCheck className="size-3" />
              All clear
            </Badge>
          )
        }
      />
      <ListingsApprovalTable initial={rows} />
    </div>
  );
}
