import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Calendar, Landmark, Rocket, Sparkles, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import {
  PremiumOrderCard,
  PremiumRowCard,
  PremiumSection,
  PremiumStat,
  PremiumSurface,
} from '@/components/dashboard/premium/premium-cards';
import { db } from '@/server/db/store';
import { formatCurrency, formatDate } from '@/lib/format';
import { getEffectiveMembershipCode, getConsultationDiscountForUser } from '@/server/memberships/service';
import { ventureOf } from '@/server/ventures/service';
import { ordersFor } from '@/server/orders/service';
import { taxCenterFor } from '@/server/taxes/service';
import { PLAN_COPY_KEYS } from '@/server/memberships/plan-view';
import { normalizePlanCode } from '@/lib/membership-benefits';
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

  const data = await db.read();
  const hasVenture = ventureOf(data, user.id) !== null;

  const firstName = user.fullName.split(' ')[0] ?? user.fullName;

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
  // The plan's translated name — never the raw code/tier (BUILDER, FOUNDER…).
  const tm = await getTranslations('membership');
  const planCode = normalizePlanCode(effectiveCode);
  const membershipLabel = tm(PLAN_COPY_KEYS[planCode ?? 'FREE'].nameKey);
  // Automatic consultation discount, resolved through the snapshot-aware
  // resolver so a grandfathered member sees their own rate (0 for Free).
  const consultationDiscountPercent = Math.round(
    (await getConsultationDiscountForUser(user.id)) * 100,
  );

  const now = new Date();
  const upcoming = data.bookings
    .filter((b) => b.userId === user.id && (b.status === 'CONFIRMED' || b.status === 'PENDING') && new Date(b.startsAt) >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);
  const orders = ordersFor(data, user.id).filter((o) => o.role === 'FOUNDER' && o.status !== 'CANCELLED' && !(o.status === 'COMPLETED' && o.review));
  const due = orders.filter((o) => o.dueGross !== null);
  const dueTotal = due.reduce((sum, o) => sum + (o.dueGross ?? 0), 0);
  const tOrders = await getTranslations('orders');
  const tCenter = await getTranslations('taxCenter');
  const today = now.toISOString().slice(0, 10);
  const userRecord = data.users.find((u) => u.id === user.id);
  const nextTax = userRecord ? taxCenterFor(data, userRecord, today).tasks.find((x) => x.state !== 'DONE') ?? null : null;
  const o = (k: string, v?: Record<string, string | number>) => t(`entrepreneur.overview.${k}`, v);
  const money = (n: number) => formatCurrency(n, lang);

  return (
    <div className="mx-auto max-w-3xl space-y-5 lg:max-w-5xl">
      <div className="hidden lg:block">
        <DashboardPageHeader title={o('greeting', { name: firstName })} subtitle={o('subtitle')} />
      </div>
      <p className="font-display text-xl font-bold tracking-tight lg:hidden">{o('greeting', { name: firstName })}</p>

      {!hasVenture && (
        <PremiumRowCard
          href="/dashboard/entrepreneur/venture"
          lead={<Rocket className="size-5" />}
          title={o('addVentureTitle')}
          meta={o('addVentureBody')}
          className="border-primary-200 bg-primary-50/50 dark:bg-primary/10"
        />
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-3xl bg-[#0E3B1E] p-5 text-white shadow-[0_14px_34px_rgba(14,59,30,0.22)] sm:p-6">
          <p className="text-[0.8125rem] text-[#B9DDC3]">{o('hireEyebrow')}</p>
          <p className="font-display text-[1.375rem] font-extrabold leading-tight">{o('hireTitle')}</p>
          <Link
            href="/dashboard/entrepreneur/hire"
            className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-white px-4 text-sm text-[#4B5B52] transition-colors hover:bg-white/90"
          >
            <Sparkles className="size-[1.125rem] shrink-0 text-primary" />
            <span className="truncate">{o('hirePlaceholder')}</span>
          </Link>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <PremiumStat label={o('statWallet')} value={money(balance)} hint={o('statWalletHint')} href="/dashboard/entrepreneur/wallet" />
          <PremiumStat
            label={o('toPay')}
            value={money(dueTotal)}
            hint={due.length ? o('toPayHint', { count: due.length }) : o('toPayNone')}
            hintTone={due.length ? 'warning' : undefined}
            href="/dashboard/entrepreneur/orders"
          />
          <PremiumStat label={o('cofounderTitle')} value={o('cofounderValue')} hint={o('cofounderHint')} href="/dashboard/entrepreneur/cofounder" />
          <PremiumStat
            label={o('statMembership')}
            value={membershipLabel}
            hint={consultationDiscountPercent > 0 ? o('statConsultationDiscount', { percent: consultationDiscountPercent }) : o('statMembershipHintFree')}
            href="/dashboard/entrepreneur/membership"
          />
        </div>
      </div>

      <PremiumRowCard
        href="/dashboard/entrepreneur/taxes"
        lead={nextTax ? (nextTax.state === 'LATE' ? '!' : t('freelancer.daysLeft', { days: nextTax.daysLeft })) : <Landmark className="size-5" />}
        leadTone={nextTax?.state === 'LATE' ? 'danger' : nextTax?.state === 'DUE_SOON' ? 'amber' : 'primary'}
        title={nextTax ? tCenter(`obligation.${nextTax.obligation}`) : t('freelancer.taxNextTitle')}
        meta={nextTax
          ? `${t('freelancer.taxNextTitle')} · ${formatDate(`${nextTax.dueDate}T12:00:00Z`, lang, { day: 'numeric', month: 'long' })}`
          : t('freelancer.taxNextNone')}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PremiumSection title={o('ordersTitle')} actionLabel={o('ordersAll')} actionHref="/dashboard/entrepreneur/orders">
          {orders.length === 0 ? (
            <PremiumSurface className="p-4 text-sm text-muted-foreground">{o('ordersEmpty')}</PremiumSurface>
          ) : (
            <div className="space-y-2.5">
              {orders.slice(0, 3).map((x) => (
                <PremiumOrderCard
                  key={x.id}
                  href={`/dashboard/entrepreneur/orders/${x.id}`}
                  title={x.title}
                  meta={`${x.other.name} · ${x.number}`}
                  status={tOrders(`status.${x.status}`)}
                  statusTone={x.dueGross !== null || x.status === 'COMPLETED' ? 'amber' : x.status === 'IN_PROGRESS' ? 'primary' : 'muted'}
                  progress={ORDER_PROGRESS[x.status] ?? 1}
                  footer={x.dueGross !== null ? `${o('toPay')} · ${money(x.dueGross)}` : money(x.total)}
                />
              ))}
            </div>
          )}
        </PremiumSection>

        <PremiumSection title={o('upcomingTitle')} actionLabel={o('ordersAll')} actionHref="/dashboard/entrepreneur/bookings">
          <PremiumSurface className="px-4 py-1">
            {upcoming.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{o('upcomingEmpty')}</p>
            ) : (
              <ul className="divide-y">
                {upcoming.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 py-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                      <Calendar className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold" dir="auto">{b.itemName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <bdi>{b.vendorName}</bdi> · {formatDate(b.startsAt, lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PremiumSurface>
        </PremiumSection>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11 rounded-xl"><Link href="/spaces">{o('bookSpace')}</Link></Button>
        <Button asChild variant="outline" className="min-h-11 rounded-xl"><Link href="/dashboard/entrepreneur/consultations"><UserCheck className="size-4" />{tRoot('dashboard.consultations')}</Link></Button>
        <Button asChild variant="outline" className="min-h-11 rounded-xl"><Link href="/dashboard/entrepreneur/startup">{o('statStartupStatus')} · {startupLabel}</Link></Button>
      </div>
    </div>
  );
}

/** How far along an order is, for the card's bar. */
const ORDER_PROGRESS: Partial<Record<string, number>> = { AWAITING_DEPOSIT: 0.1, IN_PROGRESS: 0.5, DELIVERED: 0.85 };
