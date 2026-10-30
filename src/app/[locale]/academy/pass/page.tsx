import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { getAcademyPricing } from '@/server/academy/settings';
import { listPublicCourses } from '@/server/academy/catalog';
import { quotePass } from '@/lib/academy';
import { PassPlans } from '@/components/features/academy/pass-plans';

export const revalidate = 60;

interface PageProps { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academy.passPage' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/** /academy/pass — the subscription: every course included in the Pass, one price. */
export default async function AcademyPassPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academy.passPage');
  const [pricing, courses] = await Promise.all([getAcademyPricing(), listPublicCourses(locale, { inPass: true })]);
  const annualPercent = Math.round(pricing.passAnnualDiscountRate * 100);

  return (
    <div>
      <section className="border-b border-border/60 bg-[radial-gradient(ellipse_at_50%_0%,hsl(142_65%_40%/0.14),transparent_60%)]">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:py-20">
          <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">Academy Pass</span>
          <h1 className="mt-5 text-balance font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{t('title')}</h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground sm:text-lg">{t('subtitle', { count: courses.length, percent: annualPercent })}</p>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <PassPlans initial={{ MONTHLY: quotePass('MONTHLY', pricing, false), ANNUAL: quotePass('ANNUAL', pricing, false) }} premiumPercent={Math.round(pricing.premiumDiscountRate * 100)} />
      </section>
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold">{t('faqTitle')}</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2">
          {(['cancel', 'download', 'renew', 'courses', 'certificate', 'refund'] as const).map((k) => (
            <div key={k} className="border-t border-border pt-4">
              <dt className="font-semibold">{t(`faq.${k}.q`)}</dt>
              <dd className="mt-1.5 text-sm text-muted-foreground">{t(`faq.${k}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
