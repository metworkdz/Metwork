import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { verifyAcademyOrder } from '@/server/academy/orders';
import { AutoRefresh } from '@/components/features/academy/auto-refresh';

export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ locale: string; orderId: string }> }

/** Back from the card checkout: the server asks SlickPay, never trusts the redirect. */
export default async function AcademyCheckoutReturnPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, orderId } = await params;
  setRequestLocale(locale);
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/academy/checkout/return/${orderId}`)}`);
  if (!/^[0-9a-f-]{36}$/.test(orderId)) notFound();
  const t = await getTranslations('academy.checkout.result');
  const view = await verifyAcademyOrder(orderId, session.user.id);
  if (view.state === 'NOT_FOUND') notFound();

  const box = 'mx-auto max-w-lg px-4 py-16 text-center';
  if (view.state === 'PAID') {
    return (
      <div className={box}>
        <CheckCircle2 className="mx-auto size-14 text-primary" aria-hidden />
        {view.order.kind === 'PASS' ? (
          <>
            <h1 className="mt-4 font-display text-2xl font-extrabold">{t('passTitle')}</h1>
            <p className="mt-2 text-muted-foreground">{t('passDesc')}</p>
            <Button asChild size="lg" className="mt-6"><Link href={{ pathname: '/academy/courses', query: { pass: '1' } }}>{t('browsePass')}</Link></Button>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-display text-2xl font-extrabold">{view.duplicate ? t('duplicateTitle') : t('paidTitle')}</h1>
            <p className="mt-2 text-muted-foreground">{view.duplicate ? t('duplicateDesc') : t('paidDesc')}</p>
            <Button asChild size="lg" className="mt-6"><Link href={`/academy/learn/${view.courseSlug}`}>{t('start')}</Link></Button>
          </>
        )}
      </div>
    );
  }
  if (view.state === 'FAILED') {
    return (
      <div className={box}>
        <XCircle className="mx-auto size-14 text-destructive" aria-hidden />
        <h1 className="mt-4 font-display text-2xl font-extrabold">{t('failedTitle')}</h1>
        <p className="mt-2 text-muted-foreground">{t('failedDesc')}</p>
        <Button asChild size="lg" variant="outline" className="mt-6"><Link href={view.order.kind === 'PASS' ? '/academy/pass' : { pathname: '/academy/checkout', query: { course: view.courseSlug } }}>{t('retry')}</Link></Button>
      </div>
    );
  }
  return (
    <div className={box}>
      <Clock className="mx-auto size-14 text-amber-600" aria-hidden />
      <h1 className="mt-4 font-display text-2xl font-extrabold">{t('pendingTitle')}</h1>
      <p className="mt-2 text-muted-foreground">{t('pendingDesc')}</p>
      <AutoRefresh seconds={8} />
    </div>
  );
}
