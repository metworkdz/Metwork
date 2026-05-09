import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Bookmark, TrendingUp, MessageSquare, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import { db } from '@/server/db/store';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['INVESTOR']);

  const data = await db.read();

  const savedCount = (data.savedStartups ?? []).filter((s) => s.userId === user.id).length;

  const pendingContacts = (data.investorContacts ?? []).filter(
    (c) => c.investorId === user.id && c.status === 'PENDING',
  ).length;

  const userDeals = (data.investments ?? []).filter((inv) => inv.investorId === user.id);
  const totalCommitted = userDeals
    .filter((d) => d.status === 'CLOSED')
    .reduce((s, d) => s + d.amount, 0);

  const activeListings = data.startupListings.filter((l) => l.status === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting={t('investor.overview.greeting', { name: user.fullName.split(' ')[0] ?? user.fullName })}
        subtitle={t('investor.overview.subtitle')}
        action={
          <Button asChild>
            <Link href="/dashboard/investor/startups">{t('investor.overview.browseStartups')}</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('investor.overview.statSavedStartups')}
          value={savedCount}
          icon={Bookmark}
        />
        <StatCard
          label={t('investor.overview.statPendingContacts')}
          value={pendingContacts}
          hint={t('investor.overview.statPendingContactsHint')}
          icon={MessageSquare}
        />
        <StatCard
          label={t('investor.overview.statCommitted')}
          value={formatCurrency(totalCommitted, lang)}
          hint={t('investor.overview.statCommittedHint')}
          icon={TrendingUp}
        />
        <StatCard
          label={t('investor.overview.statActiveListings')}
          value={activeListings}
          hint={t('investor.overview.statActiveListingsHint')}
          icon={Rocket}
        />
      </div>
    </div>
  );
}
