import { setRequestLocale } from 'next-intl/server';
import { Calendar } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { MentorBookingsTable, type BookingRow } from '@/components/features/admin/mentor-bookings-table';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminMentorBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);

  const data = await db.read();
  const bookings = (data.mentorBookings ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const rows: BookingRow[] = bookings.map((b) => {
    const mentor = data.mentors.find((m) => m.id === b.mentorId);
    return { ...b, mentorName: mentor?.fullName ?? 'Unknown mentor' };
  });

  const pendingCount = rows.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Consultation requests"
        subtitle="Review and respond to mentor booking requests from founders."
        action={
          pendingCount > 0 ? (
            <Badge variant="warning" className="gap-1">
              <Calendar className="size-3" />
              {pendingCount} pending
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Calendar className="size-3" />
              {rows.length} total
            </Badge>
          )
        }
      />
      <MentorBookingsTable initial={rows} />
    </div>
  );
}
