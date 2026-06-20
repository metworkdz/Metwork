/**
 * Investor dashboard gate.
 *
 * Single reusable chokepoint for the investor approval flow: every investor
 * dashboard page (overview, startup directory, saved, meetings, portfolio,
 * settings) renders through this layout. While the investor is not APPROVED we
 * render a blocking "awaiting approval" state instead of the page content, so
 * the gating logic never diverges per page. Approved investors get full access.
 */
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { getInvestorApproval } from '@/lib/investor-guard';
import { AwaitingApproval } from '@/components/shared/awaiting-approval';

export const dynamic = 'force-dynamic';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function InvestorDashboardLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireRole(['INVESTOR']);
  const data = await db.read();
  const record = data.users.find((u) => u.id === user.id);
  const approval = getInvestorApproval(record ?? {});

  if (approval !== 'APPROVED') {
    const t = await getTranslations('investorApproval');
    const rejected = approval === 'REJECTED';
    return (
      <AwaitingApproval
        title={rejected ? t('rejectedTitle') : t('title')}
        description={rejected ? t('rejectedDescription') : t('description')}
        reasonLabel={rejected ? t('reasonLabel') : undefined}
        reason={rejected ? record?.investorRejectionReason ?? null : null}
      />
    );
  }

  return <>{children}</>;
}
