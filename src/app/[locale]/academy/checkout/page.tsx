import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Infinity as InfinityIcon, ShieldCheck } from 'lucide-react';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { quoteForBuyer } from '@/server/academy/orders';
import { getWallet } from '@/server/wallet/service';
import { getAcademyPricing } from '@/server/academy/settings';
import { canBuyAcademy } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import { Link } from '@/i18n/routing';
import { CourseCover } from '@/components/features/academy/course-cover';
import { CheckoutForm } from '@/components/features/academy/checkout-form';
import { formatDzd } from '@/components/features/academy/format';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ course?: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academy.checkout' });
  return { title: t('title'), robots: { index: false } };
}

export default async function AcademyCheckoutPage({ params, searchParams }: PageProps) {
  assertAcademyEnabled();
  const { locale } = await params;
  setRequestLocale(locale);
  const { course: slug = '' } = await searchParams;
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/academy/checkout?course=${slug}`)}`);
  const t = await getTranslations('academy');

  const q = await quoteForBuyer(session.user, slug);
  if (!q.ok) redirect(`/${locale}/academy/courses`);
  if (q.owned) redirect(`/${locale}/academy/learn/${q.course.slug}`);
  const [wallet, pricing] = await Promise.all([getWallet(session.user.id), getAcademyPricing()]);
  const title = resolveText(q.course.title, locale);
  const money = (n: number) => t('money', { price: formatDzd(n, locale) });

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{t('checkout.title')}</h1>
        <div className="mt-6">
          {canBuyAcademy(session.user.role) ? (
            <CheckoutForm
              courseSlug={q.course.slug}
              amountDzd={q.quote.amountDzd}
              walletBalance={wallet?.balance ?? 0}
              locale={(['fr', 'en', 'ar'].includes(locale) ? locale : 'fr') as 'fr' | 'en' | 'ar'}
              amountLabel={money(q.quote.amountDzd)}
            />
          ) : (
            <p className="rounded-2xl border border-border p-5 text-sm text-muted-foreground">{t('checkout.errors.NOT_A_BUYER')}</p>
          )}
        </div>
      </section>
      <aside className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('checkout.summary')}</h2>
        <div className="flex gap-3">
          <CourseCover course={{ id: q.course.id, title, thumbnailUrl: q.course.thumbnailUrl }} className="w-28 shrink-0" />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold">{title}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><InfinityIcon className="size-3.5" aria-hidden />{t('course.lifetime')}</p>
          </div>
        </div>
        <dl className="space-y-2 border-t border-border pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">{t('checkout.coursePrice')}</dt><dd className="tabular-nums">{money(q.quote.listPriceDzd)}</dd></div>
          {q.quote.discount === 'PREMIUM' && (
            <div className="flex justify-between text-amber-700 dark:text-amber-400">
              <dt>{t('checkout.premiumDiscount', { percent: Math.round(pricing.premiumDiscountRate * 100) })}</dt>
              <dd className="tabular-nums">−{money(q.quote.discountDzd)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-display text-lg font-extrabold"><dt>{t('checkout.total')}</dt><dd className="tabular-nums">{money(q.quote.amountDzd)}</dd></div>
        </dl>
        {!q.premium && (
          <p className="text-xs text-muted-foreground">
            {t('checkout.premiumNudge', { percent: Math.round(pricing.premiumDiscountRate * 100) })}{' '}
            <Link href="/pricing" className="font-semibold text-primary hover:underline">{t('checkout.premiumNudgeCta')}</Link>
          </p>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />{t('checkout.refundNote')}</p>
      </aside>
    </div>
  );
}
