import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, BarChart3, Percent, Target, User } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StartupDetailActions } from '@/components/features/investor/startup-detail-actions';
import { requireRole } from '@/lib/auth-guards';
import { findStartupById } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

function formatDZD(amount: number) {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function InvestorStartupDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [user, t] = await Promise.all([
    requireRole(['INVESTOR']),
    getTranslations('pages.dashboard.investor.startupDetail'),
  ]);

  const record = await findStartupById(id);
  if (!record || record.status !== 'ACTIVE') notFound();

  const startup = toStartupDto(record);
  const data    = await db.read();

  const founder  = data.users.find((u) => u.id === startup.founderId);
  const isSaved  = (data.savedStartups ?? []).some(
    (s) => s.userId === user.id && s.startupId === id,
  );

  const metrics = [
    { icon: Target,   label: t('metricFundingGoal'),        value: formatDZD(startup.fundingGoal)   },
    { icon: Percent,  label: t('metricEquityOffered'),       value: `${startup.equityOffered}%`       },
    ...(startup.valuation
      ? [{ icon: BarChart3, label: t('metricPreMoneyValuation'), value: formatDZD(startup.valuation) }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={startup.name}
        subtitle={startup.industry}
        action={
          <Link
            href="/dashboard/investor/startups"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t('backToMarketplace')}
          </Link>
        }
      />

      {/* Industry badge */}
      <Badge variant="primary" className="text-sm px-3 py-1">{startup.industry}</Badge>

      {/* Description */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">{t('aboutHeading')}</h2>
          <p className="text-sm leading-relaxed whitespace-pre-line">{startup.description}</p>
        </CardContent>
      </Card>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        {metrics.map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                <Icon className="size-4" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Founder */}
      {founder && (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-5 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
            <User className="size-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('founderLabel')}</p>
            <p className="text-sm font-medium">{founder.fullName}</p>
            <p className="text-xs text-muted-foreground">{founder.city}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <StartupDetailActions
        startupId={startup.id}
        startupName={startup.name}
        isSaved={isSaved}
      />
    </div>
  );
}
