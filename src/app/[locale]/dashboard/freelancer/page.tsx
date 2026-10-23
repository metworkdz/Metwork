import { setRequestLocale, getTranslations } from 'next-intl/server';
import { FileText, Link2, Users, CalendarClock } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.freelancer');
  return { title: t('title') };
}

/**
 * Freelancer overview — phase-0 shell. The workspace modules land in phase 3;
 * until then this page only tells the freelancer what is coming, so the role
 * has a real, guarded home instead of a redirect loop.
 */
export default async function FreelancerOverviewPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.freelancer');
  const user = await requireRole(['FREELANCER']);
  const firstName = user.fullName.split(' ')[0] ?? user.fullName;

  const upcoming = [
    { icon: FileText,      label: t('upcomingInvoices') },
    { icon: Link2,         label: t('upcomingPaymentLinks') },
    { icon: Users,         label: t('upcomingClients') },
    { icon: CalendarClock, label: t('upcomingTaxCalendar') },
  ];

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('greeting', { name: firstName })} subtitle={t('subtitle')} />
      <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
        <h2 className="text-base font-semibold">{t('comingTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('comingBody')}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {upcoming.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">{label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
