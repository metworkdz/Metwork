import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { BookingsManager } from '@/components/features/incubator/bookings-manager';
import { applicableTemplates } from '@/server/contracts/service';
import { db, type BookingRecord } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Bookings' };

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  contractTemplates?: { id: string; name: string }[];
};

export default async function AdminIncubatorBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const incubator = await getOrCreateAdminIncubator(user.id);
  const data = await db.read();

  const ownedSpaceIds = new Set(
    (data.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  // Space category lookup + this incubator's contract templates → applicable
  // "Download contract" options per SPACE booking.
  const spaceCategoryById = new Map((data.spaces ?? []).map((s) => [s.id, s.category]));
  const myTemplates = (data.contractTemplates ?? []).filter((c) => c.incubatorId === incubator.id);

  const bookings: BookingWithCustomer[] = data.bookings
    .filter(
      (b) =>
        (b.itemKind === 'SPACE' && ownedSpaceIds.has(b.itemId)) ||
        (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => {
      const customer = b.userId ? data.users.find((u) => u.id === b.userId) : null;
      return {
        ...b,
        customerName: customer?.fullName ?? b.clientName ?? 'Unknown',
        customerEmail: customer?.email ?? b.clientEmail ?? '',
        customerPhone: customer?.phone ?? b.clientPhone ?? '',
        contractTemplates: b.itemKind === 'SPACE'
          ? applicableTemplates(myTemplates, spaceCategoryById.get(b.itemId) ?? null).map((c) => ({ id: c.id, name: c.name }))
          : [],
      };
    });

  const pending = bookings.filter((b) => b.status === 'PENDING').length;
  const spaces = (data.spaces ?? []).filter((s) => s.incubatorId === incubator.id && s.isActive);
  const programs = (data.programs ?? []).filter((p) => p.incubatorId === incubator.id && p.isActive);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubator.bookings.title')}
        subtitle={t('admin.incubator.bookings.subtitle', { count: pending })}
      />
      <BookingsManager initial={bookings} incubator={incubator} spaces={spaces} programs={programs} />
    </div>
  );
}
