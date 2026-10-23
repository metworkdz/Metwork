import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { Link } from '@/i18n/routing';
import { OrderDetail } from '@/components/features/orders/order-detail';
import { db } from '@/server/db/store';
import { orderView } from '@/server/orders/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

// Generic title: metadata resolves before the page's access check.
export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('orders');
  return { title: t('pageTitle') };
}

export default async function FreelancerOrderPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('orders');
  const session = await requireRole(['FREELANCER']);
  const data = await db.read();
  const order = (data.serviceOrders ?? []).find((o) => o.id === id);
  const view = order ? orderView(data, order, session.id) : null;
  if (!view) notFound();
  const wallet = data.wallets.find((w) => w.userId === session.id);
  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/dashboard/freelancer/orders" className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4 rtl:rotate-180" />{t('back')}
      </Link>
      <OrderDetail
        initial={view}
        walletBalance={view.role === 'FOUNDER' ? wallet?.balance ?? 0 : null}
        messagesPath="/dashboard/freelancer/messages"
        walletPath="/dashboard/freelancer/wallet"
      />
    </div>
  );
}
