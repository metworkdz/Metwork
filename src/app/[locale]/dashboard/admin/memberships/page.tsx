import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CreditCard } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { MembershipsManager, type MembershipRow } from '@/components/features/admin/memberships-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Memberships' };

export default async function AdminMembershipsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();

  // Build one row per user, enriched with their active membership
  const rows: MembershipRow[] = data.users.map((user) => {
    const activeMembership = data.userMemberships.find(
      (m) => m.userId === user.id && m.status === 'ACTIVE',
    );
    return {
      userId:           user.id,
      fullName:         user.fullName,
      email:            user.email,
      role:             user.role,
      membershipCode:   user.membershipCode,
      membershipId:     activeMembership?.id ?? null,
      expiresAt:        activeMembership?.expiresAt ?? null,
      membershipStatus: activeMembership?.status ?? null,
    };
  });

  const activePlans = data.userMemberships.filter((m) => m.status === 'ACTIVE').length;
  const paidPlans   = data.userMemberships.filter(
    (m) => m.status === 'ACTIVE' && m.plan !== 'FREE',
  ).length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.memberships.title')}
        subtitle={t('admin.memberships.subtitle')}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.memberships.statTotal')}  value={rows.length}  icon={CreditCard} />
        <StatCard label={t('admin.memberships.statActive')} value={activePlans}               />
        <StatCard label={t('admin.memberships.statPaid')}   value={paidPlans}                 />
      </div>

      <MembershipsManager initial={rows} />
    </div>
  );
}
