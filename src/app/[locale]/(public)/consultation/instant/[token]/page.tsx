/**
 * /[locale]/consultation/instant/[token]
 *
 * Where a member lands after paying for a consultation — whichever rail they
 * chose (wallet top-up, CIB/Edahabia, or Visa/Mastercard). The booking is
 * verified and settled SERVER-SIDE on render; arriving here is never itself
 * treated as proof of payment.
 *
 * The token is the credential (unguessable, single-use, 7-day), matching the
 * guest pay page — deliberately not session-gated, so a session that expired
 * during a hosted checkout can't strand a payer away from their confirmation.
 *
 * Amounts are DZD only. The EUR figure and the exchange rate that produced it
 * are never rendered here, whatever the payer's card was billed.
 */
import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  CalendarClock,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { verifyAndSettleByToken } from '@/server/consultations/settle-return';
import { InstantPaymentPoller } from './poller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Consultation — Metwork',
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

export default async function ConsultationInstantReturnPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.consultationReturn');
  // Verify + settle on every render. Idempotent, provider-verified.
  const view = await verifyAndSettleByToken(token);

  const fmtAmount = (n: number) => `${n.toLocaleString(intlLocale(locale))} DZD`;
  const scheduleLine = (() => {
    const b = view.booking;
    if (!b?.consultationDate) return null;
    return b.consultationTime ? `${b.consultationDate} · ${b.consultationTime}` : b.consultationDate;
  })();

  return (
    <section className="py-14 sm:py-20">
      <Container size="sm">
        <div className="mx-auto max-w-md">
          {view.state === 'CONFIRMED' && (
            <Card className="border-border/60">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="size-7" />
                  </div>
                  <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('confirmedTitle')}</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t('confirmedDesc')}</p>
                </div>

                <dl className="mt-6 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 text-sm">
                  {view.mentor && <Row label={t('consultant')} value={view.mentor.fullName} />}
                  {scheduleLine && <Row label={t('date')} value={scheduleLine} />}
                  {view.booking?.durationMinutes && (
                    <Row
                      label={t('duration')}
                      value={`${view.booking.durationMinutes} ${t('minutes')}`}
                    />
                  )}
                  {view.amount != null && view.amount > 0 && (
                    <div className="flex items-center justify-between bg-emerald-50/60 px-4 py-3">
                      <dt className="font-semibold text-emerald-800">{t('amountPaid')}</dt>
                      <dd className="text-base font-bold text-emerald-800">{fmtAmount(view.amount)}</dd>
                    </div>
                  )}
                </dl>

                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {t('detailsByEmail')}
                </p>

                <Button asChild className="mt-6 w-full">
                  <Link href="/dashboard/entrepreneur/consultations">{t('myConsultations')}</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {view.state === 'AWAITING_PAYMENT' && (
            <Card className="border-border/60">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                    <CalendarClock className="size-7" />
                  </div>
                  <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('pendingTitle')}</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t('pendingDesc')}</p>
                </div>
                {/* Polls the settle endpoint — covers the payer landing back
                    before the provider's webhook has reached us. */}
                <InstantPaymentPoller token={token} />
              </CardContent>
            </Card>
          )}

          {view.state === 'EXPIRED' && (
            <StatusCard
              tone="warning"
              icon={<Clock className="size-7" />}
              title={t('expiredTitle')}
              desc={t('expiredDesc')}
              actionHref="/mentors"
              actionLabel={t('browseConsultants')}
            />
          )}

          {view.state === 'REJECTED' && (
            <StatusCard
              tone="error"
              icon={<XCircle className="size-7" />}
              title={t('cancelledTitle')}
              desc={t('cancelledDesc')}
              actionHref="/mentors"
              actionLabel={t('browseConsultants')}
            />
          )}

          {view.state === 'INVALID' && (
            <StatusCard
              tone="error"
              icon={<AlertTriangle className="size-7" />}
              title={t('invalidTitle')}
              desc={t('invalidDesc')}
              actionHref="/"
              actionLabel={t('backHome')}
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
  actionHref,
  actionLabel,
}: {
  tone: 'success' | 'warning' | 'error';
  icon: React.ReactNode;
  title: string;
  desc: string;
  actionHref: string;
  actionLabel: string;
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
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
