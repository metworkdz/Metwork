import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { getCourseForAdmin, publishProblems, redactCourseForBuilder } from '@/server/academy/catalog';
import { getAcademyPricing, listAcademyFields } from '@/server/academy/settings';
import { resolveText } from '@/lib/localized-text';
import { isMentorApproved } from '@/lib/mentor-approval';
import { CourseBuilder } from '@/components/features/academy/admin/course-builder';

interface PageProps { params: Promise<{ locale: string; id: string }> }

export default async function AdminCourseBuilderPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);
  const tf = await getTranslations('academy.fields');

  const course = await getCourseForAdmin(id);
  if (!course) notFound();
  const [problems, fields, pricing, d] = await Promise.all([
    publishProblems(course), listAcademyFields({ includeHidden: true }), getAcademyPricing(), db.read(),
  ]);

  return (
    <CourseBuilder
      initial={redactCourseForBuilder(course)}
      initialProblems={problems}
      fields={fields.map((f) => ({ id: f.id, label: f.label ? resolveText(f.label, locale) : tf(`${f.id}.name`) }))}
      mentors={[...d.mentors].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((m) => ({ id: m.id, fullName: m.fullName, approved: isMentorApproved(m) }))}
      premiumDiscountRate={pricing.premiumDiscountRate}
      locale={locale}
    />
  );
}
