import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { listCoursesForAdmin } from '@/server/academy/catalog';
import { listAcademyFields } from '@/server/academy/settings';
import { listReviewQueue } from '@/server/academy/studio';
import { Link } from '@/i18n/routing';
import { resolveText } from '@/lib/localized-text';
import { isLocale, type Locale } from '@/i18n/config';
import { CoursesAdmin, type AdminCourseRow } from '@/components/features/academy/admin/courses-admin';
import { AcademyModeration } from '@/components/features/academy/admin/academy-moderation';

interface PageProps { params: Promise<{ locale: string }> }

export default async function AdminAcademyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);
  const t = await getTranslations('academyAdmin');
  const tf = await getTranslations('academy.fields');

  const [courses, fields, d, queue] = await Promise.all([listCoursesForAdmin(), listAcademyFields({ includeHidden: true }), db.read(), listReviewQueue(locale)]);
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
      {queue.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
          <h2 className="font-display text-base font-extrabold">{t('review.title', { count: queue.length })}</h2>
          <ul className="mt-2 divide-y divide-amber-200 dark:divide-amber-800">
            {queue.map((q) => (
              <li key={q.courseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Link href={`/dashboard/admin/academy/courses/${q.courseId}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{q.title}</Link>
                <span className="text-muted-foreground">{q.mentorName}</span>
                <span className="text-xs text-amber-800 dark:text-amber-300">
                  {q.kind === 'COURSE' ? t('review.course') : t('review.modules', { count: q.pendingModules })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <CoursesAdmin
        rows={rows}
        fields={fields.map((f) => ({ id: f.id, label: fieldLabel(f.id) }))}
        mentors={[...d.mentors].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((m) => ({ id: m.id, fullName: m.fullName }))}
        locale={(isLocale(locale) ? locale : 'fr') as Locale}
      />
      <AcademyModeration />
    </div>
  );
}
