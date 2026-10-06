/**
 * /dashboard/incubator/promo-codes
 *
 * The home of an incubator's own promo codes. Everything the client component
 * needs is read here, scoped to the incubator the signed-in user MANAGES, so the
 * page cannot show another incubator's codes or listings.
 */
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { PromoCodesManager } from '@/components/features/incubator/promo-codes-manager';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { listIncubatorPromoCodes } from '@/server/promo-codes/incubator-service';
import { toScopedPromoCode } from '@/lib/promo-code-ui';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Promo codes' };

export default async function IncubatorPromoCodesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = (data.incubators ?? []).find((i) => i.managerId === user.id);

  const codes = incubator ? (await listIncubatorPromoCodes(incubator.id)).map(toScopedPromoCode) : [];
  const programs = incubator
    ? (data.programs ?? [])
        .filter((p) => p.incubatorId === incubator.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => ({ id: p.id, title: p.title, city: p.city }))
    : [];
  const spaces = incubator
    ? (data.spaces ?? [])
        .filter((s) => s.incubatorId === incubator.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((s) => ({ id: s.id, name: s.name, city: s.city }))
    : [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.promoCodes.title')}
        subtitle={t('incubator.promoCodes.subtitle')}
      />
      <PromoCodesManager codes={codes} programs={programs} spaces={spaces} />
    </div>
  );
}
