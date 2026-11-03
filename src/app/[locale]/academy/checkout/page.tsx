import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Gift, GraduationCap, Infinity as InfinityIcon, Layers, RefreshCw, ShieldCheck } from 'lucide-react';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { quoteForBuyer } from '@/server/academy/orders';
import { passStatusFor } from '@/server/academy/pass';
import { getWallet } from '@/server/wallet/service';
import { getAcademyPricing } from '@/server/academy/settings';
import { canBuyAcademy, quotePass, isAcademyPremium, type CourseQuote } from '@/lib/academy';
import { quoteBundle } from '@/server/academy/bundles';
import { REFERRAL_COOKIE, referralDiscountFor } from '@/server/academy/referral';
import { resolveText } from '@/lib/localized-text';
import { Link } from '@/i18n/routing';
import { CourseCover } from '@/components/features/academy/course-cover';
import { CheckoutForm } from '@/components/features/academy/checkout-form';
import { formatDzd } from '@/components/features/academy/format';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ course?: string; pass?: string; bundle?: string; gift?: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academy.checkout' });
  return { title: t('title'), robots: { index: false } };
}

/**
 * One checkout for a course (?course=slug), an Academy Pass term
 * (?pass=MONTHLY|ANNUAL) or a bundle (?bundle=slug); `&gift=1` buys a course or
 * one Pass month for someone else.
 */
export default async function AcademyCheckoutPage({ params, searchParams }: PageProps) {
  assertAcademyEnabled();
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const bundleSlug = sp.bundle ?? '';
  const asGift = sp.gift === '1' && !bundleSlug;
  // A gift of the Pass is one month.
  const pass = asGift && sp.pass ? 'MONTHLY' : sp.pass === 'MONTHLY' || sp.pass === 'ANNUAL' ? sp.pass : null;
  const slug = sp.course ?? '';
  const giftQs = asGift ? '&gift=1' : '';
  const here = bundleSlug
    ? `/${locale}/academy/checkout?bundle=${bundleSlug}`
    : pass ? `/${locale}/academy/checkout?pass=${pass}${giftQs}` : `/${locale}/academy/checkout?course=${slug}${giftQs}`;
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(here)}`);
  const t = await getTranslations('academy');
  const [wallet, pricing] = await Promise.all([getWallet(session.user.id), getAcademyPricing()]);
  const money = (n: number) => t('money', { price: formatDzd(n, locale) });
  const safeLocale = (['fr', 'en', 'ar'].includes(locale) ? locale : 'fr') as 'fr' | 'en' | 'ar';

  let quote: CourseQuote;
  let premium: boolean;
  let target: { courseSlug: string } | { pass: 'MONTHLY' | 'ANNUAL' } | { bundleSlug: string };
  let item: React.ReactNode;
  let ownedNote: string | null = null;

  if (bundleSlug) {
    const q = await quoteBundle(session.user, bundleSlug);
    if (!q.ok) redirect(`/${locale}/academy/courses`);
    const b = q.quote;
    quote = { listPriceDzd: b.listTotalDzd, amountDzd: b.amountDzd, discount: 'NONE', discountDzd: b.listTotalDzd - b.amountDzd };
    premium = false;
    target = { bundleSlug };
    if (b.ownedCourseIds.length) ownedNote = t('checkout.bundleOwned', { count: b.ownedCourseIds.length });
    item = (
      <div className="flex gap-3">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Layers className="size-7" aria-hidden /></span>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold">{resolveText(b.bundle.title, locale)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('paths.courses', { count: b.items.length })}</p>
        </div>
      </div>
    );
  } else if (pass && asGift) {
    quote = quotePass('MONTHLY', pricing, isAcademyPremium(session.user));
    premium = quote.discount === 'PREMIUM';
    target = { pass: 'MONTHLY' };
    item = (
      <div className="flex gap-3">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(120deg,#057A41,#04A54F)' }}><Gift className="size-7" aria-hidden /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('gift.passItem')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('gift.passItemDesc')}</p>
        </div>
      </div>
    );
  } else if (pass) {
    const status = await passStatusFor(session.user);
    // A monthly Pass that renews by itself has nothing to buy: manage it instead.
    if (status.active?.autoRenew) redirect(`/${locale}/academy/my`);
    quote = status.quotes[pass];
    premium = status.premium;
    target = { pass };
    item = (
      <div className="flex gap-3">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(120deg,#057A41,#04A54F)' }}>
          <GraduationCap className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{pass === 'ANNUAL' ? t('passPage.annualName') : t('passPage.monthlyName')}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" aria-hidden />{pass === 'ANNUAL' ? t('passPage.annualRenew') : t('passPage.monthlyRenew')}
          </p>
          {status.active && <p className="mt-1 text-xs text-primary">{t('checkout.passQueued', { date: new Date(status.active.periodEnd).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB', { day: 'numeric', month: 'long' }) })}</p>}
        </div>
      </div>
    );
  } else {
    const q = await quoteForBuyer(session.user, slug);
    if (!q.ok) redirect(`/${locale}/academy/courses`);
    // Owning a course does not stop you from offering it.
    if (q.owned && !asGift) redirect(`/${locale}/academy/learn/${q.course.slug}`);
    quote = q.quote;
    premium = q.premium;
    target = { courseSlug: q.course.slug };
    const title = resolveText(q.course.title, locale);
    item = (
      <div className="flex gap-3">
        <CourseCover course={{ id: q.course.id, title, thumbnailUrl: q.course.thumbnailUrl }} className="w-28 shrink-0" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold">{title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><InfinityIcon className="size-3.5" aria-hidden />{t('course.lifetime')}</p>
        </div>
      </div>
    );
  }

  // First Academy purchase through a referral link: 10 % off (not on gifts). Decided on the server again at payment.
  const referralCode = (await cookies()).get(REFERRAL_COOKIE)?.value ?? null;
  const referralDzd = asGift ? 0 : await referralDiscountFor(session.user, referralCode, quote.amountDzd);
  const total = quote.amountDzd - referralDzd;

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{asGift ? t('gift.checkoutTitle') : t('checkout.title')}</h1>
        <div className="mt-6">
          {canBuyAcademy(session.user.role) ? (
            <CheckoutForm target={target} asGift={asGift} amountDzd={total} walletBalance={wallet?.balance ?? 0} locale={safeLocale} amountLabel={money(total)} />
          ) : (
            <p className="rounded-2xl border border-border p-5 text-sm text-muted-foreground">{t('checkout.errors.NOT_A_BUYER')}</p>
          )}
        </div>
      </section>
      <aside className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('checkout.summary')}</h2>
        {item}
        <dl className="space-y-2 border-t border-border pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">{bundleSlug ? t('checkout.bundleList') : pass ? t('checkout.passPrice') : t('checkout.coursePrice')}</dt><dd className="tabular-nums">{money(quote.listPriceDzd)}</dd></div>
          {bundleSlug && quote.discountDzd > 0 && (
            <div className="flex justify-between text-primary"><dt>{t('checkout.bundleSaving')}</dt><dd className="tabular-nums">−{money(quote.discountDzd)}</dd></div>
          )}
          {quote.discount === 'PREMIUM' && (
            <div className="flex justify-between text-amber-700 dark:text-amber-400">
              <dt>{t('checkout.premiumDiscount', { percent: Math.round(pricing.premiumDiscountRate * 100) })}</dt>
              <dd className="tabular-nums">−{money(quote.discountDzd)}</dd>
            </div>
          )}
          {referralDzd > 0 && (
            <div className="flex justify-between text-primary"><dt>{t('checkout.referralDiscount')}</dt><dd className="tabular-nums">−{money(referralDzd)}</dd></div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-display text-lg font-extrabold"><dt>{t('checkout.total')}</dt><dd className="tabular-nums">{money(total)}</dd></div>
        </dl>
        {ownedNote && <p className="text-xs text-muted-foreground">{ownedNote}</p>}
        {!premium && !bundleSlug && (
          <p className="text-xs text-muted-foreground">
            {t('checkout.premiumNudge', { percent: Math.round(pricing.premiumDiscountRate * 100) })}{' '}
            <Link href="/pricing" className="font-semibold text-primary hover:underline">{t('checkout.premiumNudgeCta')}</Link>
          </p>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />{asGift ? t('gift.note') : pass ? t('checkout.passNote') : t('checkout.refundNote')}</p>
      </aside>
    </div>
  );
}
