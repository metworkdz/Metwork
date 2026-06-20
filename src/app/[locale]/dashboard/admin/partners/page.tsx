import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Network } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { PartnerManagement } from '@/components/features/admin/partner-management';
import { db } from '@/server/db/store';
import { ensurePartnerPerIncubatorMigration } from '@/server/network/partner-incubator-service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Partner Network' };

export default async function AdminPartnersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.admin.partners');
  await requireRole(['ADMIN']);

  // Run the one-time per-space → per-incubator migration before counting.
  await ensurePartnerPerIncubatorMigration();
  const data = await db.read();

  // Per-incubator partner records (legacy per-space records are superseded).
  const incubatorPartners = data.partnerMemberships.filter((p) => p.incubatorId);
  const totalPartners  = incubatorPartners.length;
  const activePartners = incubatorPartners.filter((p) => p.isActive).length;
  const passEnabled    = incubatorPartners.filter((p) => p.isActive && p.acceptNetworkPasses).length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total enrolled"      value={totalPartners}  icon={Network} />
        <StatCard label="Active"              value={activePartners}               />
        <StatCard label="Accept Network Pass" value={passEnabled}                  />
      </div>

      <PartnerManagement />
    </div>
  );
}
