/**
 * The public pre-launch Startup Academy page (waitlist form). The Academy
 * itself lives at /academy; after the public launch (`isAcademyAnnounced`) this
 * address sends visitors there.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isAcademyAnnounced } from '@/config/feature-flags';
import { assertLandingVisible } from '@/lib/landing-visibility';
import { AcademyComingSoon } from '@/components/features/academy/academy-coming-soon';

// ISR: the landing-visibility toggle propagates without a redeploy.
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('academy');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.academy');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function StartupAcademyPage({ params }: PageProps) {
  await assertLandingVisible('academy');
  const { locale } = await params;
  setRequestLocale(locale);
  if (isAcademyAnnounced()) redirect(`/${locale}/academy`);
  return <AcademyComingSoon />;
}
