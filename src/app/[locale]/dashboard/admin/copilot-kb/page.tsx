import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { CopilotKbManager } from '@/components/features/admin/copilot-kb-manager';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminCopilotKbPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);
  const t = await getTranslations('admin.copilotKb');
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <CopilotKbManager />
    </div>
  );
}
