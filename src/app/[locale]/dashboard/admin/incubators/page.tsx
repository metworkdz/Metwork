import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2 } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { db } from '@/server/db/store';
import { Badge } from '@/components/ui/badge';
import { AdminIncubatorsManager } from '@/components/features/admin/incubators-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Incubators' };

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminIncubatorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const incubators = (data.incubators ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const activeCount = incubators.filter((i) => i.status === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Incubators"
        subtitle="Manage registered incubators and their platform access."
        action={
          <Badge variant="outline" className="gap-1">
            <Building2 className="size-3" />
            {activeCount} active
          </Badge>
        }
      />
      <AdminIncubatorsManager initial={incubators} />
    </div>
  );
}
