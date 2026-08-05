import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { listMentorCategories } from '@/server/mentor-categories/service';
import { MentorCategoriesManager } from '@/components/features/admin/mentor-categories-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminMentorCategoriesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const categories = await listMentorCategories();

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.mentorCategories.title')}
        subtitle={t('admin.mentorCategories.subtitle')}
      />
      <MentorCategoriesManager categories={categories} />
    </div>
  );
}
