import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { GigsManager } from '@/components/features/freelancer/gigs-manager';
import { db } from '@/server/db/store';
import { listGigs } from '@/server/freelancers/workspace';
import { entitlementsForUser } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FreelancerGigsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.gigs');
  const session = await requireRole(['FREELANCER']);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id) ?? session;
  const ent = entitlementsForUser(user);
  const gigs = listGigs(data, session.id).map(({ id, title, description, price, deliveryDays, revisions, isActive }) => ({
    id, title, description, price, deliveryDays, revisions, isActive,
  }));
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <GigsManager initial={gigs} activeLimit={ent?.audience === 'FREELANCER' ? ent.gigs : null} />
    </div>
  );
}
