import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Rocket, CheckCircle2, FileEdit } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { AdminStartupsManager, type AdminStartupView } from '@/components/features/admin/startups-manager';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { toStartupDto } from '@/server/startups/serialize';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminStartupsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const usersById = new Map(data.users.map((u) => [u.id, u]));

  const startups: AdminStartupView[] = data.startupListings
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((listing) => {
      const founder = usersById.get(listing.founderId);
      return {
        ...toStartupDto(listing),
        founderName: founder?.fullName ?? null,
        founderEmail: founder?.email ?? null,
      };
    });

  const active = startups.filter((s) => s.status === 'ACTIVE').length;
  const draft = startups.filter((s) => s.status === 'DRAFT').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.startups.title')}
        subtitle={t('admin.startups.subtitle')}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.startups.statTotal')} value={startups.length} icon={Rocket} />
        <StatCard label={t('admin.startups.statActive')} value={active} icon={CheckCircle2} />
        <StatCard label={t('admin.startups.statDraft')} value={draft} icon={FileEdit} />
      </div>

      <AdminStartupsManager initial={startups} />
    </div>
  );
}
