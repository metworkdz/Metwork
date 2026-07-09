import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  CalendarClock,
  Wallet as WalletIcon,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { db } from '@/server/db/store';
import { getServerSession } from '@/lib/session';
import { hashPaymentLinkToken } from '@/server/bookings/request-mode';
import { RequestPayButton } from './request-pay-button';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Complete your booking — Metwork',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ token?: string }>;
}

function intlLocale(locale: string): string {
  if (locale === 'ar') return 'ar-DZ';
  if (locale === 'en') return 'en-GB';
  return 'fr-DZ';
}

type ViewState =
  | 'PAYABLE'
  | 'ALREADY_PAID'
  | 'EXPIRED'
  | 'DECLINED'
  | 'WRONG_ACCOUNT'
  | 'INVALID';

export default async function RequestBookingPayPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('pages.bookingRequestPay');

  const [data, session] = await Promise.all([db.read(), getServerSession()]);
  const booking = data.bookings.find((b) => b.id === id);

  // Resolve the view state server-side. The token is the viewing credential:
  // without a hash match the page reveals nothing about the booking.
  let state: ViewState = 'INVALID';
  if (
    booking &&
    booking.reservationMode === 'REQUEST' &&
    token &&
    booking.paymentLinkTokenHash &&
    hashPaymentLinkToken(token) === booking.paymentLinkTokenHash
  ) {
    if (booking.paidAt || booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') {
      state = 'ALREADY_PAID';
    } else if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
      state = 'DECLINED';
    } else if (booking.status !== 'APPROVED_UNPAID') {
      state = 'INVALID';
    } else if (
      booking.paymentLinkExpiresAt &&
      Date.parse(booking.paymentLinkExpiresAt) < Date.now()
    ) {
      state = 'EXPIRED';
    } else if (session && session.id !== booking.userId) {
      state = 'WRONG_ACCOUNT';
    } else {
      state = 'PAYABLE';
    }
  }

  const isOwner = !!session && !!booking && session.id === booking.userId;
  const walletBalance = isOwner
    ? data.wallets.find((w) => w.userId === session.id)?.balance ?? 0
    : null;

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

  const payPath = `/booking/${id}/pay?token=${encodeURIComponent(token ?? '')}`;

  return (
    <section className="py-14 sm:py-20">
      <Container size="sm">
        <div className="mx-auto max-w-md">
          {state === 'PAYABLE' && booking && (
            <Card className="border-border/60">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                    <CalendarClock className="size-6" />
                  </div>
                  <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('payableTitle')}</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t('payableDesc')}</p>
                </div>

                <dl className="mt-6 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 text-sm">
                  <Row label={t('item')} value={booking.itemName} />
                  {booking.vendorName && <Row label={t('provider')} value={booking.vendorName} />}
                  {fmtDate(booking.startsAt) && (
                    <Row label={t('from')} value={fmtDate(booking.startsAt)!} />
                  )}
                  {fmtDate(booking.endsAt) && <Row label={t('to')} value={fmtDate(booking.endsAt)!} />}
                  <div className="flex items-center justify-between bg-emerald-50/60 px-4 py-3">
                    <dt className="font-semibold text-emerald-800">{t('amountDue')}</dt>
                    <dd className="text-base font-bold text-emerald-800">
                      {fmtAmount(booking.totalAmount)}
                    </dd>
                  </div>
                </dl>

                {walletBalance != null && (
                  <div className="mt-4 flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <WalletIcon className="size-3.5" />
                      {t('walletBalance')}
                    </span>
                    <span className="font-medium tabular-nums">{fmtAmount(walletBalance)}</span>
                  </div>
                )}

                <div className="mt-6">
                  {isOwner ? (
                    <RequestPayButton bookingId={booking.id} token={token!} />
                  ) : (
                    <Button asChild className="w-full" size="lg">
                      <Link href={`/login?next=${encodeURIComponent(payPath)}`}>
                        {t('loginToPay')}
                      </Link>
                    </Button>
                  )}
                </div>

                {booking.paymentLinkExpiresAt && (
                  <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" />
                    {t('expiresOn', { date: fmtDate(booking.paymentLinkExpiresAt) ?? '' })}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {state === 'ALREADY_PAID' && (
            <StatusCard
              tone="success"
              icon={<CheckCircle2 className="size-7" />}
              title={t('confirmedTitle')}
              desc={t('confirmedDesc')}
              homeLabel={t('backHome')}
            />
          )}

          {state === 'EXPIRED' && (
            <StatusCard
              tone="warning"
              icon={<Clock className="size-7" />}
              title={t('expiredTitle')}
              desc={t('expiredDesc')}
              homeLabel={t('backHome')}
            />
          )}

          {state === 'DECLINED' && (
            <StatusCard
              tone="error"
              icon={<XCircle className="size-7" />}
              title={t('declinedTitle')}
              desc={t('declinedDesc')}
              homeLabel={t('backHome')}
            />
          )}

          {state === 'WRONG_ACCOUNT' && (
            <StatusCard
              tone="warning"
              icon={<AlertTriangle className="size-7" />}
              title={t('wrongAccountTitle')}
              desc={t('wrongAccountDesc')}
              homeLabel={t('backHome')}
            />
          )}

          {state === 'INVALID' && (
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
