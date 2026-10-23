import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ConsultationsPageBody } from '@/components/features/bookings/consultations-page-body';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Mentor sessions — same panel and prices as entrepreneurs, Premium discount included. */
export default async function FreelancerConsultationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.consultations');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['FREELANCER']);
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConsultationsPageBody user={user} locale={lang} />
    </div>
  );
}
