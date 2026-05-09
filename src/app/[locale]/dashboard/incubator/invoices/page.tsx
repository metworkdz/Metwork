import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoicesManager } from '@/components/features/incubator/invoices-manager';
import { db, type BookingRecord } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Invoices & Receipts' };

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
};

export default async function IncubatorInvoicesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);

  let bookings: BookingWithCustomer[] = [];
  if (incubator) {
    const ownedSpaceIds = new Set(
      data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );

    bookings = data.bookings
      .filter(
        (b) =>
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED' &&
          (
            (b.itemKind === 'SPACE' && ownedSpaceIds.has(b.itemId)) ||
            (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId))
          ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => {
        const customer = data.users.find((u) => u.id === b.userId);
        return {
          ...b,
          customerName: customer?.fullName ?? 'Unknown',
          customerEmail: customer?.email ?? '',
        };
      });
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.invoices.title')}
        subtitle={t('incubator.invoices.subtitle')}
      />
      <InvoicesManager initial={bookings} />
    </div>
  );
}
