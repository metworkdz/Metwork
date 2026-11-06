import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { assertLandingVisible } from '@/lib/landing-visibility';
import { AcademyLanding } from '@/components/features/academy/academy-landing';
import { getAcademyPricing, listAcademyFields } from '@/server/academy/settings';
import { listPublicCourses } from '@/server/academy/catalog';

// ISR: the landing-visibility toggle and the admin's Pass price propagate
// without a redeploy (re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // or an Academy not launched yet returns a real 404 status (the page-body
  // gate alone streams 200 + 404 UI).
  assertAcademyEnabled();
  await assertLandingVisible('academy');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academy.meta');
  return { title: t('title'), description: t('description') };
}

export default async function AcademyPage({ params }: PageProps) {
  assertAcademyEnabled();
  await assertLandingVisible('academy');
  const { locale } = await params;
  setRequestLocale(locale);

  const [pricing, fields, courses] = await Promise.all([getAcademyPricing(), listAcademyFields(), listPublicCourses(locale)]);
  return <AcademyLanding locale={locale} pricing={pricing} fields={fields} courses={courses.slice(0, 4)} />;
}
