import { setRequestLocale } from 'next-intl/server';
import { LayoutTemplate } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { CmsEditor } from '@/components/features/admin/cms-editor';
import { getLandingContent } from '@/server/cms/service';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminCmsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);

  const content = await getLandingContent();
  const isDefault = content.updatedAt === new Date(0).toISOString();

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Landing page"
        subtitle="Edit the public landing page content. Changes go live immediately on publish."
        action={
          <Badge variant={isDefault ? 'outline' : 'success'} className="gap-1">
            <LayoutTemplate className="size-3" />
            {isDefault ? 'Using defaults' : 'Custom content'}
          </Badge>
        }
      />
      <CmsEditor initial={content} />
    </div>
  );
}
