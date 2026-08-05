import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Users } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { MentorsManager } from '@/components/features/admin/mentors-manager';
import { requireRole } from '@/lib/auth-guards';
import { listMentors } from '@/server/mentors/service';
import { toMentorPrivateDto } from '@/server/mentors/serialize';
import { listMentorCategories } from '@/server/mentor-categories/service';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminMentorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  // Server-render with the live roster — instant first paint, no flash.
  // Admin view → private DTO so the edit form sees the consultant phone.
  const [mentors, categories] = await Promise.all([
    listMentors().then((list) => list.map(toMentorPrivateDto)),
    listMentorCategories(),
  ]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.mentors.title')}
        subtitle={t('admin.mentors.subtitle')}
        action={
          <Badge variant="outline" className="gap-1">
            <Users className="size-3" />
            {mentors.length} live
          </Badge>
        }
      />
      <MentorsManager initial={mentors} categories={categories} />
    </div>
  );
}
