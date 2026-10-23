import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CalendarClock, FileText, Landmark, Link2, Plus, Sparkles } from 'lucide-react';
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
  const userRecord = data.users.find((u) => u.id === session.id);
  const nextTax = userRecord ? taxCenterFor(data, userRecord, today).tasks.find((x) => x.state !== 'DONE') ?? null : null;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('greeting', { name: firstName })}
        subtitle={t('subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/dashboard/freelancer/invoices/new"><FileText className="size-4" />{t('newInvoice')}</Link></Button>
            <Button asChild><Link href="/dashboard/freelancer/payment-links"><Link2 className="size-4" />{t('newLink')}</Link></Button>
          </div>
        }
      />

      {percent < 100 && (
        <Link
          href="/dashboard/freelancer/profile"
          className="flex items-center gap-4 rounded-lg border border-primary-200 bg-primary-50/50 p-4 transition-colors hover:bg-primary-50 dark:bg-primary/10"
        >
          <span className="text-3xl font-bold tabular-nums text-primary-700">{percent}%</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t('completeTitle')}</span>
            <span className="block text-xs text-muted-foreground">{t('completeBody')}</span>
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('statReceived')} value={money(receivedThisMonth)} hint={t('statWallet', { amount: money(wallet?.balance ?? 0) })} />
        <Stat label={t('statInvoiced')} value={money(facturesThisMonth.reduce((s, i) => s + i.totals.ht, 0))} hint={t('statInvoicedCount', { count: facturesThisMonth.length })} />
        <Stat label={t('statProjects')} value={String(open.length)} hint={t('statDueSoon', { count: dueSoon.length })} />
        <Stat label={t('statTurnover', { year: now.getUTCFullYear() })} value={money(turnover)} hint={ceiling ? t('statCeiling', { percent: Math.round(ceiling.share * 100) }) : t('statTurnoverHint')} />
      </div>

      {ceiling && (
        <section className="space-y-3 rounded-lg border p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('ceilingTitle')}</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{money(ceiling.turnover)} / {money(ceiling.ceiling)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ceiling.share * 100)} aria-label={t('ceilingTitle')}>
            <div
              className={cn('h-full rounded-full', ceiling.alert === 0.95 ? 'bg-destructive' : ceiling.alert === 0.8 ? 'bg-amber-500' : 'bg-primary')}
              style={{ width: `${Math.max(2, ceiling.share * 100)}%` }}
            />
          </div>
          {ceiling.alert && <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{t('ceilingAlert', { percent: Math.round(ceiling.alert * 100) })}</p>}
          <p className="text-xs text-muted-foreground">{t('ifuEstimate', { amount: money(ceiling.estimatedIfu) })}</p>
        </section>
      )}

      <Link
        href="/dashboard/freelancer/taxes"
        className={cn(
          'flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50',
          nextTax?.state === 'LATE' && 'border-destructive/60',
        )}
      >
        <Landmark className="size-5 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{t('taxNextTitle')}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {nextTax
              ? `${tCenter(`obligation.${nextTax.obligation}`)} · ${formatDate(`${nextTax.dueDate}T12:00:00Z`, lang, { day: 'numeric', month: 'long' })}`
              : t('taxNextNone')}
          </span>
        </span>
      </Link>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" />{t('dueTitle')}</h2>
            <Link href="/dashboard/freelancer/projects" className="text-sm font-medium text-primary hover:underline">{t('seeAll')}</Link>
          </div>
          {dueSoon.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dueEmpty')}</p>
          ) : (
            <ul className="divide-y">
              {dueSoon.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.title}</span>
                    {p.clientName && <span className="block truncate text-xs text-muted-foreground">{p.clientName}</span>}
                  </span>
                  <span className={cn('shrink-0 text-xs tabular-nums', p.dueDate! < today ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                    {new Date(`${p.dueDate}T12:00:00Z`).toLocaleDateString(lang, { day: 'numeric', month: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" />{t('comingTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('comingBody')}</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>• {t('upcomingCopilot')}</li>
            <li>• {t('upcomingHiring')}</li>
          </ul>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/dashboard/freelancer/gigs"><Plus className="size-4" />{t('addGig')}</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-lg border p-3 sm:p-4">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
