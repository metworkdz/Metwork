import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { listPerks } from '@/server/perks/service';
import { PerksManager } from '@/components/features/admin/perks-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminPerksPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const perks = await listPerks();

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.perks.title')}
        subtitle={t('admin.perks.subtitle')}
      />
      <PerksManager perks={perks} />
    </div>
  );
}
