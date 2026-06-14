import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Briefcase, Calendar, Rocket, Wallet, CreditCard, UserCheck, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import {
  MobileGreeting,
  MobileQuickActions,
  MobileStatGrid,
  MobileSection,
  MobileListRow,
  MobileEmpty,
} from '@/components/dashboard/mobile/mobile-overview';
import { mobileQuickActionsByRole } from '@/config/mobile-nav';
import { db } from '@/server/db/store';
import { formatCurrency } from '@/lib/format';
import { getEffectiveMembershipCode, getUserConsultationQuota } from '@/server/memberships/service';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const tRoot = await getTranslations();
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);

  const [data, consultationQuota] = await Promise.all([
    db.read(),
    getUserConsultationQuota(user.id),
  ]);

  // Active / pending bookings
  const activeBookings = data.bookings.filter(
    (b) => b.userId === user.id && (b.status === 'CONFIRMED' || b.status === 'PENDING'),
  ).length;

  // Programs applied to
  const programsApplied = data.bookings.filter(
    (b) => b.userId === user.id && b.itemKind === 'PROGRAM' && b.status !== 'CANCELLED' && b.status !== 'REFUNDED',
  ).length;

  // Wallet balance
  const wallet = data.wallets.find((w) => w.userId === user.id);
  const balance = wallet?.balance ?? 0;

  // Startup status
  const myStartup = data.startupListings.find((s) => s.founderId === user.id);
  const startupLabel = myStartup
    ? myStartup.status === 'ACTIVE'
      ? 'Listed'
      : myStartup.status === 'DRAFT'
      ? 'Draft'
      : 'Closed'
    : 'Not created';

  // Membership
  const effectiveCode = getEffectiveMembershipCode(user);
  const membershipLabel = effectiveCode === 'FREE' ? 'Free' : effectiveCode.charAt(0) + effectiveCode.slice(1).toLowerCase();

  // Recent bookings (mobile list) — newest first, top 4. Display only.
  const recentBookings = data.bookings
    .filter((b) => b.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  const dateFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
  const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

  return (
    <>
      {/* ── Mobile app UI (below lg) ─────────────────────────────────────── */}
      <div className="lg:hidden">
        <MobileGreeting
          title={t('entrepreneur.overview.greeting', { name: user.fullName.split(' ')[0] ?? user.fullName })}
          subtitle={t('entrepreneur.overview.subtitle')}
        />
        <MobileQuickActions
          actions={mobileQuickActionsByRole.ENTREPRENEUR.map((a) => ({
            label: tRoot(a.labelKey),
            href: a.href,
            icon: a.icon,
          }))}
        />
        <MobileStatGrid
          stats={[
            { label: t('entrepreneur.overview.statActiveBookings'), value: activeBookings, icon: Calendar },
            { label: t('entrepreneur.overview.statPrograms'), value: programsApplied, icon: Briefcase },
            { label: t('entrepreneur.overview.statWallet'), value: formatCurrency(balance, lang), icon: Wallet },
            { label: t('entrepreneur.overview.statStartupStatus'), value: startupLabel, hint: myStartup?.name, icon: Rocket },
            { label: t('entrepreneur.overview.statMembership'), value: membershipLabel, icon: CreditCard, tone: 'gold' },
            { label: t('entrepreneur.overview.statConsultations'), value: `${consultationQuota.remaining} / ${consultationQuota.quota}`, icon: UserCheck, tone: 'blue' },
          ]}
        />
        <MobileSection
          title={tRoot('dashboard.recentBookings')}
          actionLabel={tRoot('common.viewAll')}
          actionHref="/dashboard/entrepreneur/bookings"
        >
          {recentBookings.length === 0 ? (
            <MobileEmpty icon={CalendarClock} text={tRoot('dashboard.nothingYet')} />
          ) : (
            recentBookings.map((b) => (
              <MobileListRow
                key={b.id}
                icon={Calendar}
                title={b.itemName}
                meta={`${b.vendorName} · ${dateFmt.format(new Date(b.startsAt))}`}
                trailing={statusLabel(b.status)}
              />
            ))
          )}
        </MobileSection>
      </div>

      {/* ── Desktop (lg+) — unchanged ────────────────────────────────────── */}
      <div className="hidden space-y-6 lg:block">
      <DashboardWelcome
        greeting={t('entrepreneur.overview.greeting', { name: user.fullName.split(' ')[0] ?? user.fullName })}
        subtitle={t('entrepreneur.overview.subtitle')}
        action={
          <Button asChild>
            <Link href="/spaces">{t('entrepreneur.overview.bookSpace')}</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t('entrepreneur.overview.statActiveBookings')}
          value={activeBookings}
          icon={Calendar}
        />
        <StatCard
          label={t('entrepreneur.overview.statPrograms')}
          value={programsApplied}
          icon={Briefcase}
        />
        <StatCard
          label={t('entrepreneur.overview.statWallet')}
          value={formatCurrency(balance, lang)}
          hint={t('entrepreneur.overview.statWalletHint')}
          icon={Wallet}
        />
        <StatCard
          label={t('entrepreneur.overview.statStartupStatus')}
          value={startupLabel}
          hint={myStartup ? myStartup.name : t('entrepreneur.overview.statStartupHintNone')}
          icon={Rocket}
        />
        <StatCard
          label={t('entrepreneur.overview.statMembership')}
          value={membershipLabel}
          hint={effectiveCode === 'FREE' ? t('entrepreneur.overview.statMembershipHintFree') : t('entrepreneur.overview.statMembershipHintActive')}
          icon={CreditCard}
        />
        <StatCard
          label={t('entrepreneur.overview.statConsultations')}
          value={`${consultationQuota.remaining} / ${consultationQuota.quota}`}
          hint={consultationQuota.quota === 0 ? t('entrepreneur.overview.statConsultationHintUpgrade') : t('entrepreneur.overview.statConsultationHintRemaining')}
          icon={UserCheck}
        />
      </div>
      </div>
    </>
  );
}
