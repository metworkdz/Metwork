import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Card, CardContent } from '@/components/ui/card';
import { getAccountLinkView } from '@/server/refunds/service';
import { RefundAccountForm } from './refund-account-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Refund — Metwork',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

export default async function RefundAccountPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('refunds.guest');
  const view = await getAccountLinkView(token);
  const intl = locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-DZ';
  const money = (n: number) => `${n.toLocaleString(intl)} DZD`;

  const notice = (icon: React.ReactNode, title: string, body: string) => (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        {icon}
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );

  return (
    <Container className="max-w-lg py-10">
      {view.state === 'INVALID' && notice(<XCircle className="size-10 text-destructive" />, t('invalidTitle'), t('invalidBody'))}
      {view.state === 'EXPIRED' && notice(<Clock className="size-10 text-amber-600" />, t('expiredTitle'), t('expiredBody'))}
      {view.state === 'DONE' &&
        notice(<CheckCircle2 className="size-10 text-green-600" />, t('refundedTitle'), t('refundedBody', { amount: money(view.amount), item: view.itemName }))}
      {view.state === 'OPEN' && (
        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="space-y-1">
              <h1 className="text-xl font-bold">{t('title')}</h1>
              <p className="text-sm text-muted-foreground">{t('subtitle', { amount: money(view.amount), item: view.itemName })}</p>
            </div>
            <RefundAccountForm token={token} alreadySubmitted={view.alreadySubmitted} defaultHolder={view.clientName} />
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
