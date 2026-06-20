import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Receipt,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { verifyAndSettlePaymentLink } from '@/server/payments/payment-links';
import { PayLinkForm } from './pay-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment — Metwork',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

function intlLocale(locale: string): string {
  if (locale === 'ar') return 'ar-DZ';
  if (locale === 'en') return 'en-GB';
  return 'fr-DZ';
}

export default async function PayLinkPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.pay');
  // Always re-verify server-side on load (handles the return from the hosted
  // checkout). Never trusts the redirect — asks the provider.
  const view = await verifyAndSettlePaymentLink(slug);

  const fmtAmount = (n: number) => `${n.toLocaleString(intlLocale(locale))} DZD`;

  const amount = view.amount ?? 0;
  const payerFee = view.payerFee ?? 0;
  const grossCharge = view.grossCharge ?? amount + payerFee;
  const incubatorName = view.incubator?.name ?? '';
  const logoUrl = view.incubator?.logoUrl ?? null;

  return (
    <section className="py-14 sm:py-20">
      <Container size="sm">
        <div className="mx-auto max-w-md">
          {view.state === 'AWAITING_PAYMENT' && view.link && (
            <Card className="border-border/60">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt={incubatorName}
                      className="size-14 rounded-full object-cover ring-1 ring-border/60"
                    />
                  ) : (
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                      <Receipt className="size-6" />
                    </div>
                  )}
                  {incubatorName && (
                    <p className="mt-3 text-sm font-medium text-muted-foreground">{incubatorName}</p>
                  )}
                  <h1 className="mt-1 text-xl font-semibold tracking-tight">{t('awaitingTitle')}</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t('awaitingDesc')}</p>
                </div>

                {/* Summary */}
                <dl className="mt-6 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 text-sm">
                  <Row label={t('service')} value={view.link.serviceName} />
                  {view.link.description && (
                    <Row label={t('description')} value={view.link.description} />
                  )}
                  <Row label={t('amount')} value={fmtAmount(amount)} />
                  {payerFee > 0 && (
                    <Row label={t('platformFee')} value={`+ ${fmtAmount(payerFee)}`} />
                  )}
                  <div className="flex items-center justify-between bg-emerald-50/60 px-4 py-3">
                    <dt className="font-semibold text-emerald-800">{t('amountDue')}</dt>
                    <dd className="text-base font-bold text-emerald-800">{fmtAmount(grossCharge)}</dd>
                  </div>
                </dl>

                <div className="mt-6">
                  <PayLinkForm slug={slug} locale={locale} />
                </div>

                <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  {t('secureNote')}
                </p>
              </CardContent>
            </Card>
          )}

          {view.state === 'PAID' && (
            <Card className="border-border/60">
              <CardContent className="flex flex-col items-center py-12 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="size-7" />
                </div>
                <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('paidTitle')}</h1>
                <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{t('paidDesc')}</p>

                {view.link && (
                  <dl className="mt-6 w-full divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 text-sm">
                    {incubatorName && <Row label={t('provider')} value={incubatorName} />}
                    <Row label={t('service')} value={view.link.serviceName} />
                    <Row label={t('amountPaid')} value={fmtAmount(grossCharge)} />
                  </dl>
                )}

                <Button asChild variant="outline" size="sm" className="mt-6">
                  <Link href="/">{t('backHome')}</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {view.state === 'EXPIRED' && (
            <StatusCard
              tone="warning"
              icon={<Clock className="size-7" />}
              title={t('expiredTitle')}
              desc={t('expiredDesc')}
              homeLabel={t('backHome')}
            />
          )}

          {view.state === 'CANCELLED' && (
            <StatusCard
              tone="error"
              icon={<XCircle className="size-7" />}
              title={t('cancelledTitle')}
              desc={t('cancelledDesc')}
              homeLabel={t('backHome')}
            />
          )}

          {view.state === 'INVALID' && (
            <StatusCard
              tone="error"
              icon={<AlertTriangle className="size-7" />}
              title={t('invalidTitle')}
              desc={t('invalidDesc')}
              homeLabel={t('backHome')}
            />
          )}
        </div>
      </Container>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function StatusCard({
  tone,
  icon,
  title,
  desc,
  homeLabel,
}: {
  tone: 'success' | 'warning' | 'error';
  icon: React.ReactNode;
  title: string;
  desc: string;
  homeLabel: string;
}) {
  const toneCls =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-600'
      : tone === 'warning'
      ? 'bg-amber-50 text-amber-600'
      : 'bg-destructive/10 text-destructive';

  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col items-center py-14 text-center">
        <div className={`flex size-14 items-center justify-center rounded-full ${toneCls}`}>
          {icon}
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{desc}</p>
        <Button asChild variant="outline" size="sm" className="mt-6">
          <Link href="/">{homeLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
