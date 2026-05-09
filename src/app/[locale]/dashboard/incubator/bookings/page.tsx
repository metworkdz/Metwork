import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { BookingsManager } from '@/components/features/incubator/bookings-manager';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import type { BookingRecord } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Bookings' };

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

export default async function IncubatorBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id) ?? null;

  let bookings: BookingWithCustomer[] = [];
  const spaces = incubator
    ? data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id && s.status === 'ACTIVE')
    : [];
  const programs = incubator
    ? data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id && p.status !== 'CLOSED')
    : [];

  if (incubator) {
    const ownedSpaceIds = new Set(spaces.map((s) => s.id));
    // Also include inactive spaces so existing bookings still show
    const allOwnedSpaceIds = new Set(
      data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );
    // Also include manually-created bookings that belong to this incubator's items
    void ownedSpaceIds; // used below via allOwnedSpaceIds

    bookings = data.bookings
      .filter(
        (b) =>
          (b.itemKind === 'SPACE' && allOwnedSpaceIds.has(b.itemId)) ||
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
        };
      });
  }

  const pending = bookings.filter((b) => b.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.bookings.title')}
        subtitle={t('incubator.bookings.subtitle', { count: pending })}
      />
      <BookingsManager
        initial={bookings}
        incubator={incubator}
        spaces={spaces}
        programs={programs}
      />
    </div>
  );
}
