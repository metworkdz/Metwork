import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TrendingUp } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { AdminInvestorsManager, type AdminInvestorView } from '@/components/features/admin/investors-manager';
import { getInvestorApproval } from '@/lib/investor-guard';
import { db } from '@/server/db/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Investors' };

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminInvestorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.investorsManager');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const investors: AdminInvestorView[] = (data.users ?? [])
    .filter((u) => u.role === 'INVESTOR')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      city: u.city,
      linkedin: u.linkedin ?? null,
      investorStatus: getInvestorApproval(u),
      investorRejectionReason: u.investorRejectionReason ?? null,
      createdAt: u.createdAt,
    }));

  const pending  = investors.filter((i) => i.investorStatus === 'PENDING_APPROVAL').length;
  const approved = investors.filter((i) => i.investorStatus === 'APPROVED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statTotal')}    value={investors.length} icon={TrendingUp} />
        <StatCard label={t('statPending')}  value={pending} />
        <StatCard label={t('statApproved')} value={approved} />
      </div>

      <AdminInvestorsManager initial={investors} />
    </div>
  );
}
