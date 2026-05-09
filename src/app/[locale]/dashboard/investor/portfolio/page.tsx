import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvestmentTracker } from '@/components/features/investor/investment-tracker';
import { db } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

export const metadata = { title: 'Portfolio' };

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorPortfolioPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['INVESTOR']);

  const data = await db.read();
  const investments = (data.investments ?? [])
    .filter((inv) => inv.investorId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('investor.portfolio.title')}
        subtitle={t('investor.portfolio.subtitle')}
      />
      <InvestmentTracker initial={investments} locale={lang} />
    </div>
  );
}
