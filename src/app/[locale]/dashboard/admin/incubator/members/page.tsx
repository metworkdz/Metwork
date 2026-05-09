import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { MembersTable } from '@/components/features/incubator/members-table';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Members' };

export default async function AdminIncubatorMembersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const incubator = await getOrCreateAdminIncubator(user.id);
  const data = await db.read();

  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  const seen = new Set<string>();
  const members = data.bookings
    .filter(
      (b) =>
        b.itemKind === 'PROGRAM' &&
        ownedProgramIds.has(b.itemId) &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .reduce<
      { userId: string; name: string; email: string; phone: string; programName: string; enrolledAt: string; bookingId: string }[]
    >((acc, b) => {
      const key = `${b.userId}:${b.itemId}`;
      if (seen.has(key)) return acc;
      seen.add(key);
      const u = b.userId ? data.users.find((x) => x.id === b.userId) : null;
      acc.push({
        userId: b.userId ?? '',
        name: u?.fullName ?? b.clientName ?? 'Unknown',
        email: u?.email ?? '',
        phone: u?.phone ?? '',
        programName: b.itemName,
        enrolledAt: b.createdAt,
        bookingId: b.id,
      });
      return acc;
    }, []);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubator.members.title')}
        subtitle={t('admin.incubator.members.subtitle', { count: members.length })}
      />
      <MembersTable initial={members} />
    </div>
  );
}
