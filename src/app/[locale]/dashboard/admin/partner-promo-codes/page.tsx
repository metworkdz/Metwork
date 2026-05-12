import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Tag } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { PromoCodeManager } from '@/components/features/admin/promo-code-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Partner Promo Codes' };

export default async function AdminPartnerPromoCodesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.admin.partnerPromoCodes');
  await requireRole(['ADMIN']);

  const data = await db.read();

  const totalCodes    = data.partnerPromoCodes.length;
  const usedCodes     = data.partnerPromoCodes.filter((c) => c.isUsed).length;
  const activeCodes   = data.partnerPromoCodes.filter(
    (c) => !c.isUsed && new Date(c.validUntil) > new Date(),
  ).length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total codes"   value={totalCodes}  icon={Tag} />
        <StatCard label="Active"        value={activeCodes}            />
        <StatCard label="Redeemed"      value={usedCodes}              />
      </div>

      <PromoCodeManager />
    </div>
  );
}
