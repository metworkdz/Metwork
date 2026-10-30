import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { getLearnView } from '@/server/academy/learn';

export const dynamic = 'force-dynamic';

/** /academy/learn/{slug} → the first unfinished lesson this viewer can play. */
export default async function AcademyLearnCoursePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  assertAcademyEnabled();
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/academy/learn/${slug}`)}`);
  const view = await getLearnView(session.user, slug, locale);
  if (!view) notFound();
  if (!view.resumeLessonId) redirect(`/${locale}/academy/courses/${slug}`);
  redirect(`/${locale}/academy/learn/${slug}/${view.resumeLessonId}`);
}
