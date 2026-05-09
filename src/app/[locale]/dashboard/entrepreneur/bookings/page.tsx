import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { MyBookingsTable } from '@/components/features/entrepreneur/my-bookings-table';
import { requireRole } from '@/lib/auth-guards';
import { listBookingsForUser } from '@/server/bookings/service';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);

  const bookings = await listBookingsForUser(user.id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.bookings.title')}
        subtitle={t('entrepreneur.bookings.subtitle')}
        action={
          <Button asChild size="sm">
            <Link href="/spaces">
              <Plus />
              Book a space
            </Link>
          </Button>
        }
      />
      <MyBookingsTable initial={bookings} locale={lang} />
    </div>
  );
}
