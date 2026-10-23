import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { TaxCenter } from '@/components/features/taxes/tax-center';
import { db } from '@/server/db/store';
import { taxCenterFor } from '@/server/taxes/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('taxCenter');
  return { title: t('pageTitle') };
}

export default async function EntrepreneurTaxesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('taxCenter');
  const session = await requireRole(['ENTREPRENEUR']);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id);
  const view = user
    ? taxCenterFor(data, user, new Date().toISOString().slice(0, 10))
    : { profile: null, regime: null, needsRegime: false, prefillEnabled: false, tasks: [] };
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <TaxCenter view={view} legalHref="/dashboard/entrepreneur/venture" membershipHref="/dashboard/entrepreneur/membership" copilotHref="/dashboard/entrepreneur/copilot" offerPrefill={false} />
    </div>
  );
}
