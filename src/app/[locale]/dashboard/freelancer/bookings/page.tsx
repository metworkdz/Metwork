import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { MyBookingsTable } from '@/components/features/entrepreneur/my-bookings-table';
import { requireRole } from '@/lib/auth-guards';
import { listBookingsForUser } from '@/server/bookings/service';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Space bookings — the same table entrepreneurs use. */
export default async function FreelancerBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.bookings');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['FREELANCER']);
  const bookings = await listBookingsForUser(user.id);
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={<Button asChild size="sm"><Link href="/spaces"><Plus />{t('book')}</Link></Button>}
      />
      <MyBookingsTable initial={bookings} locale={lang} />
    </div>
  );
}
