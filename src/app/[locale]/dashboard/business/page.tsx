import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { AnalyticsDashboard } from '@/components/features/incubator/analytics-dashboard';
import { MobileGreeting, MobileQuickActions } from '@/components/dashboard/mobile/mobile-overview';
import { mobileQuickActionsByRole } from '@/config/mobile-nav';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const dynamic = 'force-dynamic';

export default async function BusinessOverviewPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.business.overview');
  const tRoot = await getTranslations();
  await requireRole(['BUSINESS']);

  return (
    <>
      {/* Mobile header (below lg): one-line greeting + quick action pills. */}
      <div className="lg:hidden">
        <MobileGreeting title={t('title')} subtitle={t('subtitle')} />
        <MobileQuickActions
          actions={mobileQuickActionsByRole.BUSINESS.map((a) => ({
            label: tRoot(a.labelKey),
            href: a.href,
            icon: a.icon,
          }))}
        />
      </div>

      {/* Desktop header (lg+) — unchanged. */}
      <div className="hidden lg:block">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Shared analytics (rendered once for both layouts). */}
      <div className="mt-6">
        <AnalyticsDashboard />
      </div>
    </>
  );
}
