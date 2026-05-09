import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TrendingUp } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { CommissionsManager } from '@/components/features/admin/commissions-manager';
import { db } from '@/server/db/store';
import { DEFAULT_COMMISSION_RULES } from '@/server/admin/settings-defaults';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Commissions' };

export default async function AdminCommissionsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  // Seed default rules on first visit if the collection is empty
  let rules = (await db.read()).commissionRules;
  if (rules.length === 0) {
    rules = await db.update((store) => {
      if (store.commissionRules.length === 0) {
        store.commissionRules.push(...DEFAULT_COMMISSION_RULES.map((r) => ({ ...r })));
      }
      return store.commissionRules;
    });
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.commissions.title')}
        subtitle={t('admin.commissions.subtitle')}
        action={<TrendingUp className="size-5 text-muted-foreground" />}
      />
      <CommissionsManager rules={rules} />
    </div>
  );
}
