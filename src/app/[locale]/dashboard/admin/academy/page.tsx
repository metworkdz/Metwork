import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { listCoursesForAdmin } from '@/server/academy/catalog';
import { listAcademyFields } from '@/server/academy/settings';
import { resolveText } from '@/lib/localized-text';
import { isLocale, type Locale } from '@/i18n/config';
import { CoursesAdmin, type AdminCourseRow } from '@/components/features/academy/admin/courses-admin';

interface PageProps { params: Promise<{ locale: string }> }

export default async function AdminAcademyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);
  const t = await getTranslations('academyAdmin');
  const tf = await getTranslations('academy.fields');

  const [courses, fields, d] = await Promise.all([listCoursesForAdmin(), listAcademyFields({ includeHidden: true }), db.read()]);
  const fieldLabel = (id: string) => {
    const f = fields.find((x) => x.id === id);
    return f?.label ? resolveText(f.label, locale) : f ? tf(`${f.id}.name`) : id;
  };
  const rows: AdminCourseRow[] = courses.map((c) => ({
    id: c.id,
    title: resolveText(c.title, locale),
    status: c.status,
    priceDzd: c.priceDzd,
    fieldLabel: fieldLabel(c.fieldId),
    mentorNames: c.mentorIds.map((id) => d.mentors.find((m) => m.id === id)?.fullName ?? '?').join(', '),
    thumbnailUrl: c.thumbnailUrl,
    lessonCount: c.modules.reduce((s, m) => s + m.lessons.length, 0),
    updatedAt: c.updatedAt,
  }));

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('list.title')} subtitle={t('list.subtitle')} />
      <CoursesAdmin
        rows={rows}
        fields={fields.map((f) => ({ id: f.id, label: fieldLabel(f.id) }))}
        mentors={[...d.mentors].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((m) => ({ id: m.id, fullName: m.fullName }))}
        locale={(isLocale(locale) ? locale : 'fr') as Locale}
      />
    </div>
  );
}
