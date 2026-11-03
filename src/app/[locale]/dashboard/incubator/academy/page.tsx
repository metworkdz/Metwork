/**
 * /dashboard/incubator/academy — Startup Academy Pass seats for the
 * incubator's members: buy (from the incubator wallet, bulk tiers) and assign.
 */
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { isAcademyEnabled } from '@/config/feature-flags';
import { getAcademySettings, seatTiersOf } from '@/server/academy/settings';
import { incubatorOfManager, listSeatBatches } from '@/server/academy/seats';
import { getWallet } from '@/server/wallet/service';
import { db } from '@/server/db/store';
import { SeatsManager } from '@/components/features/academy/incubator/seats-manager';

interface PageProps { params: Promise<{ locale: string }> }

export const metadata = { title: 'Startup Academy' };

export default async function IncubatorAcademyPage({ params }: PageProps) {
  if (!isAcademyEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academyIncubator');
  const user = await requireRole(['INCUBATOR']);
  const incubator = incubatorOfManager(await db.read(), user.id);
  const [batches, settings, wallet] = await Promise.all([listSeatBatches(user.id), getAcademySettings(), getWallet(user.id)]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      {!incubator ? (
        <p className="rounded-2xl border border-border p-5 text-sm text-muted-foreground">{t('noIncubator')}</p>
      ) : (
        <SeatsManager
          initialBatches={batches ?? []}
          monthlyPriceDzd={settings.passMonthlyPriceDzd}
          tiers={seatTiersOf(settings)}
          walletBalance={wallet?.balance ?? 0}
        />
      )}
    </div>
  );
}
