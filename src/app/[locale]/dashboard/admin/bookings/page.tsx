import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Calendar } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { AdminBookingsTable } from '@/components/features/admin/admin-bookings-table';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'All Bookings' };

export default async function AdminBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();

  const rows = [...(data.bookings ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => {
      const user = data.users.find((u) => u.id === b.userId);
      return {
        ...b,
        customerName: user?.fullName ?? 'Unknown',
        customerEmail: user?.email ?? '',
      };
    });

  const pending = rows.filter((r) => r.status === 'PENDING').length;
  const total = rows.length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.bookings.title')}
        subtitle={t('admin.bookings.subtitle', { total, pending })}
        action={
          pending > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              <Calendar className="size-3" />
              {pending} pending
            </span>
          ) : undefined
        }
      />
      <AdminBookingsTable initial={rows} />
    </div>
  );
}
