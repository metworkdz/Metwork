import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LayoutTemplate } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { CmsEditor } from '@/components/features/admin/cms-editor';
import { getLandingContent } from '@/server/cms/service';
import { defaultLandingContent } from '@/server/cms/defaults';
import type { LandingContent } from '@/types/cms';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminCmsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const saved = await getLandingContent();
  const isCustom = saved !== null;

  const content: LandingContent = saved ?? {
    ...defaultLandingContent,
    updatedAt: new Date(0).toISOString(),
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.cms.title')}
        subtitle={t('admin.cms.subtitle')}
        action={
          <Badge variant={isCustom ? 'success' : 'outline'} className="gap-1">
            <LayoutTemplate className="size-3" />
            {isCustom ? 'Custom content' : 'Using defaults'}
          </Badge>
        }
      />
      <CmsEditor initial={content} />
    </div>
  );
}
