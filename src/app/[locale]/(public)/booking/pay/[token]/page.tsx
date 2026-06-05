import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  CalendarClock,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { verifyAndSettleCardBooking } from '@/server/bookings/card-payment';
import { BookingPayButton } from './pay-button';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Booking payment — Metwork',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

function intlLocale(locale: string): string {
  if (locale === 'ar') return 'ar-DZ';
  if (locale === 'en') return 'en-GB';
  return 'fr-DZ';
}

export default async function BookingPayPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.bookingPay');
  // Always re-verify server-side on load (handles the return from the hosted
  // checkout). Never trusts the redirect — asks the provider.
  const view = await verifyAndSettleCardBooking(token);

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString(intlLocale(locale), {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      });
    } catch {
      return iso;
    }
  };
  const fmtAmount = (n: number) => `${n.toLocaleString(intlLocale(locale))} DZD`;

  const isDeposit = view.paymentMode === 'CASH_DEPOSIT';
  const cashRemaining = view.cashRemaining ?? 0;

  return (
    <section className="py-14 sm:py-20">
      <Container size="sm">
        <div className="mx-auto max-w-md">
          {view.state === 'AWAITING_PAYMENT' && view.booking && (
            <Card className="border-border/60">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                    <CalendarClock className="size-6" />
                  </div>
                  <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('awaitingTitle')}</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {isDeposit ? t('awaitingDescDeposit') : t('awaitingDescFull')}
                  </p>
                </div>

                {/* Summary */}
                <dl className="mt-6 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 text-sm">
                  <Row label={t('item')} value={view.booking.itemName} />
                  {view.booking.vendorName && (
                    <Row label={t('provider')} value={view.booking.vendorName} />
                  )}
                  {fmtDate(view.booking.startsAt) && (
                    <Row label={t('date')} value={fmtDate(view.booking.startsAt)!} />
                  )}
                  <Row label={t('total')} value={fmtAmount(view.total ?? 0)} />
                  {isDeposit && cashRemaining > 0 && (
                    <Row label={t('cashOnSite')} value={fmtAmount(cashRemaining)} />
                  )}
                  <div className="flex items-center justify-between bg-emerald-50/60 px-4 py-3">
                    <dt className="font-semibold text-emerald-800">
                      {isDeposit ? t('depositDue') : t('amountDue')}
                    </dt>
                    <dd className="text-base font-bold text-emerald-800">{fmtAmount(view.onlineAmount ?? 0)}</dd>
                  </div>
                </dl>

                <div className="mt-6">
                  <BookingPayButton token={token} />
                </div>

                <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  {t('secureNote')}
                </p>
              </CardContent>
            </Card>
          )}

          {view.state === 'CONFIRMED' && (
            <StatusCard
              tone="success"
              icon={<CheckCircle2 className="size-7" />}
              title={t('confirmedTitle')}
              desc={
                isDeposit && cashRemaining > 0
                  ? t('confirmedDescDeposit', { amount: fmtAmount(cashRemaining) })
                  : t('confirmedDescFull')
              }
              homeLabel={t('backHome')}
            />
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

          {view.state === 'SLOT_TAKEN' && (
            <StatusCard
              tone="error"
              icon={<XCircle className="size-7" />}
              title={t('slotTakenTitle')}
              desc={t('slotTakenDesc')}
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
