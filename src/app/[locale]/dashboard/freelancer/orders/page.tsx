import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { OrdersList } from '@/components/features/orders/orders-list';
import { db } from '@/server/db/store';
import { ordersFor } from '@/server/orders/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('orders');
  return { title: t('pageTitle') };
}

export default async function FreelancerOrdersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('orders');
  const session = await requireRole(['FREELANCER']);
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitleFreelancer')} />
      <OrdersList orders={ordersFor(await db.read(), session.id)} basePath="/dashboard/freelancer/orders" emptyHint={t('emptyFreelancer')} />
    </div>
  );
}
