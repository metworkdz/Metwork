import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoicesTabs } from '@/components/features/incubator/invoices-tabs';
import { db, type BookingRecord, type InvoiceRecord } from '@/server/db/store';

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

  let invoices: InvoiceRecord[] = [];
  let receipts: BookingWithCustomer[] = [];
  let legalComplete = false;

  if (incubator) {
    legalComplete = Boolean(
      incubator.name &&
      (incubator.commercialRegNumber ?? incubator.registrationNumber) &&
      incubator.nif,
    );

    invoices = (data.invoices ?? [])
      .filter((i) => i.incubatorId === incubator.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const ownedSpaceIds = new Set(
      (data.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );

    receipts = data.bookings
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
      <InvoicesTabs
        invoices={invoices}
        receipts={receipts}
        legalComplete={legalComplete}
      />
    </div>
  );
}
