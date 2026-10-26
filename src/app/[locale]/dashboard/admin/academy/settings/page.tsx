import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { getAcademySettings } from '@/server/academy/settings';
import { AcademySettingsForm } from '@/components/features/academy/admin/academy-settings-form';

interface PageProps { params: Promise<{ locale: string }> }

export default async function AdminAcademySettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);
  const t = await getTranslations('academyAdmin.settings');
  const [settings, d] = await Promise.all([getAcademySettings(), db.read()]);
  const courses = d.academyCourses ?? [];
  // Mentors already teaching first, then everyone else alphabetically.
  const mentors = d.mentors
    .map((m) => ({ id: m.id, fullName: m.fullName, rate: m.academyShareRate ?? null, courseCount: courses.filter((c) => c.mentorIds.includes(m.id)).length }))
    .sort((a, b) => (b.courseCount > 0 ? 1 : 0) - (a.courseCount > 0 ? 1 : 0) || a.fullName.localeCompare(b.fullName));

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <AcademySettingsForm initial={settings} mentors={mentors} />
    </div>
  );
}
