import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ShieldCheck } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import {
  AdminAccountApprovalsManager,
  type AdminAccountView,
  type AdminAccountRole,
} from '@/components/features/admin/account-approvals-manager';
import { getApprovalStatus } from '@/lib/approval-guard';
import { db } from '@/server/db/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Account approvals' };

interface PageProps {
  params: Promise<{ locale: string }>;
}

const GATED_ROLES: AdminAccountRole[] = ['INCUBATOR', 'INVESTOR', 'BUSINESS'];

export default async function AdminApprovalsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.accountApprovals');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const providerByManager = new Map(
    (data.incubators ?? []).filter((i) => i.managerId).map((i) => [i.managerId as string, i]),
  );

  const accounts: AdminAccountView[] = (data.users ?? [])
    .filter((u): u is typeof u & { role: AdminAccountRole } =>
      GATED_ROLES.includes(u.role as AdminAccountRole),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((u) => {
      const provider = providerByManager.get(u.id);
      const isInvestor = u.role === 'INVESTOR';
      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        city: u.city,
        role: u.role,
        approvalStatus: getApprovalStatus(u),
        rejectionReason:
          (isInvestor ? u.investorRejectionReason : u.approvalRejectionReason) ?? null,
        createdAt: u.createdAt,
        orgName: provider?.name ?? null,
        businessSubType: u.businessSubType ?? null,
        website: u.businessWebsite ?? provider?.website ?? null,
        instagram: u.businessInstagram ?? provider?.instagram ?? null,
        linkedin: u.linkedin ?? null,
      };
    });

  const pending  = accounts.filter((a) => a.approvalStatus === 'PENDING').length;
  const approved = accounts.filter((a) => a.approvalStatus === 'APPROVED').length;
  const rejected = accounts.filter((a) => a.approvalStatus === 'REJECTED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statPending')}  value={pending} icon={ShieldCheck} />
        <StatCard label={t('statApproved')} value={approved} />
        <StatCard label={t('statRejected')} value={rejected} />
      </div>

      <AdminAccountApprovalsManager initial={accounts} />
    </div>
  );
}
