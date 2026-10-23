import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { PaymentLinksManager } from '@/components/features/incubator/payment-links-manager';
import { InvoicingPathsProvider } from '@/components/features/incubator/invoicing-paths';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { entitlementsForUser } from '@/lib/entitlements';
import { FREELANCER_INVOICING_PATHS } from '@/config/freelancer-invoicing';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FreelancerPaymentLinksPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.paymentLinks');
  const user = await requireRole(['FREELANCER']);
  const record = (await db.read()).users.find((u) => u.id === user.id) ?? user;
  const ent = entitlementsForUser(record);
  const fee = ent?.paymentLinkFeePercent ?? 3;
  const limit = ent?.activePaymentLinks ?? null;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        {fee > 0 ? t('feeFree', { fee, limit: limit ?? 0 }) : t('feePremium')}
      </p>
      <InvoicingPathsProvider paths={FREELANCER_INVOICING_PATHS}>
        <PaymentLinksManager />
      </InvoicingPathsProvider>
    </div>
  );
}
