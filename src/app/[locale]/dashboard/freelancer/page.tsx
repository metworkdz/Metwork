import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowUpRight, FileText, Landmark, Link2, Plus, Sparkles } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { db } from '@/server/db/store';
import { computeCompletion } from '@/lib/freelancer-completion';
import { listProjects } from '@/server/freelancers/workspace';
import { invoicesFor } from '@/server/invoices/owner';
import { aeCeilingView, turnoverForYear } from '@/lib/turnover';
import { formatCurrency, formatDate } from '@/lib/format';
import { taxCenterFor } from '@/server/taxes/service';
import { isListed } from '@/server/hiring/directory';
import { ordersFor } from '@/server/orders/service';
import {
  HeroActions,
  PremiumHero,
  PremiumOrderCard,
  PremiumRowCard,
  PremiumSection,
  PremiumStat,
  PremiumSurface,
} from '@/components/dashboard/premium/premium-cards';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.freelancer');
  return { title: t('title') };
}

/**
 * Freelancer overview — the Monday questions: what came in, what is due,
 * what is late, and how close the auto-entrepreneur ceiling is.
 */
export default async function FreelancerOverviewPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale as Locale;
  const t = await getTranslations('pages.dashboard.freelancer');
  const session = await requireRole(['FREELANCER']);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id) ?? session;
  const profile = data.freelancerProfiles?.find((p) => p.userId === session.id) ?? null;
  const { percent } = computeCompletion(user, profile);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const wallet = data.wallets.find((w) => w.userId === session.id);
  // Money received through Metwork this month: payment-link payouts, net of
  // the link fee booked against them.
  const monthTx = data.transactions.filter(
    (tx) => tx.userId === session.id && tx.status === 'COMPLETED' && new Date(tx.createdAt) >= monthStart,
  );
  const receivedThisMonth = monthTx.reduce(
    (sum, tx) => sum + (tx.type === 'PAYOUT' ? tx.amount : tx.type === 'COMMISSION' ? tx.amount : 0),
    0,
  );
  const invoices = invoicesFor(data, { type: 'FREELANCER', id: session.id });
  const facturesThisMonth = invoices.filter(
    (i) => (i.kind ?? 'FACTURE') === 'FACTURE' && i.status !== 'CANCELLED' && new Date(i.issuedAt) >= monthStart,
  );
  const projects = listProjects(data, session.id);
  const open = projects.filter((p) => p.status !== 'PAID');
  const soon = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const dueSoon = open.filter((p) => p.dueDate && p.dueDate <= soon && p.status !== 'DELIVERED').slice(0, 5);

  const turnover = turnoverForYear(invoices, now.getUTCFullYear());
  const isAe = profile?.invoiceSettings?.invoiceLegalStatus === 'AUTO_ENTREPRENEUR' || profile?.legal?.status === 'AUTO_ENTREPRENEUR';
  const ceiling = isAe ? aeCeilingView(turnover) : null;
  const firstName = user.fullName.split(' ')[0] ?? user.fullName;
  const money = (n: number) => formatCurrency(n, lang);
  const tCenter = await getTranslations('taxCenter');
  const listed = isListed(data, session.id);
  const userRecord = data.users.find((u) => u.id === session.id);
  const nextTax = userRecord ? taxCenterFor(data, userRecord, today).tasks.find((x) => x.state !== 'DONE') ?? null : null;

  const orders = ordersFor(data, session.id).filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED');
  // Gross still to come in on live orders: the whole order before the
  // deposit, the balance after it.
  const toCollect = orders.reduce((sum, o) => sum + (o.status === 'AWAITING_DEPOSIT' ? o.total : o.balanceAmount), 0);
  const tOrders = await getTranslations('orders');
  const taxLead = nextTax ? (nextTax.state === 'LATE' ? '!' : t('daysLeft', { days: nextTax.daysLeft })) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 lg:max-w-5xl">
      <div className="hidden lg:block">
        <DashboardPageHeader title={t('greeting', { name: firstName })} subtitle={t('subtitle')} />
      </div>
      <p className="font-display text-xl font-bold tracking-tight lg:hidden">{t('greeting', { name: firstName })}</p>

      {percent < 100 && (
        <PremiumRowCard
          href="/dashboard/freelancer/profile"
          lead={`${percent}%`}
          title={t('completeTitle')}
          meta={t('completeBody')}
          className="border-primary-200 bg-primary-50/50 dark:bg-primary/10"
        />
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <PremiumHero
          eyebrow={t('walletEyebrow')}
          value={money(wallet?.balance ?? 0)}
          figures={[
            { label: t('heroMonth'), value: `+${money(receivedThisMonth)}` },
            { label: t('heroToCollect'), value: money(toCollect) },
          ]}
        >
          <HeroActions
            actions={[
              { label: t('newLink'), href: '/dashboard/freelancer/payment-links', icon: Link2 },
              { label: t('newInvoice'), href: '/dashboard/freelancer/invoices/new', icon: FileText },
              { label: t('withdraw'), href: '/dashboard/freelancer/wallet', icon: ArrowUpRight },
            ]}
          />
        </PremiumHero>

        <div className="space-y-5">
          <PremiumRowCard
            href="/dashboard/freelancer/taxes"
            lead={taxLead ?? <Landmark className="size-5" />}
            leadTone={nextTax?.state === 'LATE' ? 'danger' : nextTax?.state === 'DUE_SOON' ? 'amber' : 'primary'}
            title={nextTax ? tCenter(`obligation.${nextTax.obligation}`) : t('taxNextTitle')}
            meta={nextTax
              ? `${t('taxNextTitle')} · ${formatDate(`${nextTax.dueDate}T12:00:00Z`, lang, { day: 'numeric', month: 'long' })}`
              : t('taxNextNone')}
          />
          <div className="grid grid-cols-2 gap-3">
            <PremiumStat
              label={t('statTurnover', { year: now.getUTCFullYear() })}
              value={money(turnover)}
              progress={ceiling ? ceiling.share : undefined}
              hint={ceiling ? t('statCeiling', { percent: Math.round(ceiling.share * 100) }) : t('statTurnoverHint')}
              hintTone={ceiling?.alert === 0.95 ? 'danger' : ceiling?.alert === 0.8 ? 'warning' : undefined}
            />
            <PremiumStat
              label={t('statInvoiced')}
              value={money(facturesThisMonth.reduce((s, i) => s + i.totals.ht, 0))}
              hint={t('statInvoicedCount', { count: facturesThisMonth.length })}
              href="/dashboard/freelancer/invoices"
            />
          </div>
        </div>
      </div>

      {ceiling?.alert && (
        <p className="rounded-[1.25rem] border border-amber-300 bg-amber-50/60 p-4 text-sm font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {t('ceilingAlert', { percent: Math.round(ceiling.alert * 100) })}
          <span className="mt-1 block text-xs font-normal">{t('ifuEstimate', { amount: money(ceiling.estimatedIfu) })}</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PremiumSection title={t('ordersTitle')} actionLabel={t('ordersAll')} actionHref="/dashboard/freelancer/orders">
          {orders.length === 0 ? (
            <PremiumSurface className="p-4 text-sm text-muted-foreground">{t('ordersEmpty')}</PremiumSurface>
          ) : (
            <div className="space-y-2.5">
              {orders.slice(0, 3).map((o) => (
                <PremiumOrderCard
                  key={o.id}
                  href={`/dashboard/freelancer/orders/${o.id}`}
                  title={o.title}
                  meta={`${o.other.name} · ${o.number}`}
                  status={tOrders(`status.${o.status}`)}
                  statusTone={o.status === 'IN_PROGRESS' ? 'primary' : o.status === 'DELIVERED' ? 'amber' : 'muted'}
                  progress={ORDER_PROGRESS[o.status] ?? 0}
                  footer={`${formatDate(o.createdAt, lang, { day: 'numeric', month: 'short' })} · ${money(o.total)}`}
                />
              ))}
            </div>
          )}
        </PremiumSection>

        <PremiumSection title={t('dueTitle')} actionLabel={t('seeAll')} actionHref="/dashboard/freelancer/projects">
          <PremiumSurface className="px-4 py-1">
            {dueSoon.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{t('dueEmpty')}</p>
            ) : (
              <ul className="divide-y">
                {dueSoon.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium" dir="auto">{p.title}</span>
                      {p.clientName && <span className="block truncate text-xs text-muted-foreground" dir="auto">{p.clientName}</span>}
                    </span>
                    <span className={cn('shrink-0 text-xs tabular-nums', p.dueDate! < today ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                      {formatDate(`${p.dueDate}T12:00:00Z`, lang, { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PremiumSurface>
        </PremiumSection>
      </div>

      <PremiumSurface className={cn('p-4 sm:p-5', !listed && 'border-amber-300')}>
        <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />{listed ? t('listedTitle') : t('unlistedTitle')}</h2>
        <p className="text-sm text-muted-foreground">{listed ? t('listedBody') : t('unlistedBody')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!listed && <Button asChild size="sm" className="min-h-11 rounded-xl"><Link href="/dashboard/freelancer/profile">{t('completeTitle')}</Link></Button>}
          <Button asChild variant="outline" size="sm" className="min-h-11 rounded-xl"><Link href="/dashboard/freelancer/gigs"><Plus className="size-4" />{t('addGig')}</Link></Button>
        </div>
      </PremiumSurface>
    </div>
  );
}

/** How far along an order is, for the card's bar. */
const ORDER_PROGRESS: Partial<Record<string, number>> = { AWAITING_DEPOSIT: 0.1, IN_PROGRESS: 0.5, DELIVERED: 0.85 };
