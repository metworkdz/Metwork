import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ConsultationsPageBody } from '@/components/features/bookings/consultations-page-body';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurConsultationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR', 'FREELANCER']);
  // Emails and payment returns link here; freelancers have their own page.
  if (user.role === 'FREELANCER') redirect({ href: '/dashboard/freelancer/consultations', locale });

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.consultations.title')}
        subtitle={t('entrepreneur.consultations.subtitle')}
      />
      <ConsultationsPageBody user={user} locale={lang} />
    </div>
  );
}
