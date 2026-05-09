import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvestorContactsManager } from '@/components/features/admin/investor-contacts-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Investor contact requests' };

export default async function AdminInvestorContactsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const contacts = (data.investorContacts ?? []).slice().sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );

  const pending = contacts.filter((c) => c.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.investorContacts.title')}
        subtitle={t('admin.investorContacts.subtitle', { count: pending })}
      />
      <InvestorContactsManager initial={contacts} />
    </div>
  );
}
