import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { HiringTab } from '@/components/features/hiring/hiring-tab';
import { db } from '@/server/db/store';
import { rankFreelancers } from '@/server/hiring/directory';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('hiring');
  return { title: t('pageTitle') };
}

export default async function EntrepreneurHirePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('hiring');
  await requireRole(['ENTREPRENEUR']);
  const ranked = rankFreelancers(await db.read(), null);
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <HiringTab initial={ranked.slice(0, 24).map((r) => r.card)} total={ranked.length} />
    </div>
  );
}
