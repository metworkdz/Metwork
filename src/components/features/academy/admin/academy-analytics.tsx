import { getTranslations } from 'next-intl/server';
import { BookOpen, GraduationCap, HandCoins, Percent, PlayCircle, RotateCcw, TrendingUp, Wallet } from 'lucide-react';
import { StatCard } from '@/components/shared/stat-card';
import { getAcademyAnalytics } from '@/server/academy/analytics';
import { formatDzd } from '@/components/features/academy/format';

/** The Startup Academy section of the admin Analytics page. */
export async function AcademyAnalyticsSection({ locale }: { locale: string }) {
  const t = await getTranslations('academyAdmin.analytics');
  const tm = await getTranslations('academy');
  const a = await getAcademyAnalytics(locale);
  const money = (n: number) => tm('money', { price: formatDzd(n, locale) });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-extrabold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle', { published: a.courses.published, drafts: a.courses.drafts })}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={TrendingUp} label={t('metworkNet')} value={money(a.metworkNetDzd)} hint={t('metworkNetHint')} />
        <StatCard icon={GraduationCap} label={t('passActive')} value={a.pass.activeMonthly + a.pass.activeAnnual} hint={t('passActiveHint', { monthly: a.pass.activeMonthly, annual: a.pass.activeAnnual, mrr: money(a.pass.mrrDzd) })} />
        <StatCard icon={BookOpen} label={t('sales')} value={money(a.sales.revenueDzd)} hint={t('salesHint', { count: a.sales.count, month: money(a.sales.thisMonthDzd) })} />
        <StatCard icon={Wallet} label={t('passRevenue')} value={money(a.pass.revenueDzd)} hint={t('passRevenueHint', { month: money(a.pass.thisMonthDzd) })} />
        <StatCard icon={HandCoins} label={t('mentors')} value={money(a.mentors.earnedDzd)} hint={t('mentorsHint', { held: money(a.mentors.heldDzd), paid: money(a.mentors.paidOutDzd) })} />
        <StatCard icon={Percent} label={t('discounts')} value={money(a.discountsAbsorbedDzd)} hint={t('discountsHint')} />
        <StatCard icon={RotateCcw} label={t('refunds')} value={money(a.sales.refundedDzd)} hint={t('refundsHint', { count: a.sales.refundedCount })} />
        <StatCard icon={PlayCircle} label={t('passHours')} value={a.passHoursThisMonth.toLocaleString(locale === 'ar' ? 'ar-DZ' : 'fr-DZ')} hint={t('passHoursHint')} />
      </div>
      {a.topCourses.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 text-start">{t('topCourse')}</th><th className="px-4 py-2.5 text-end">{t('topSales')}</th><th className="px-4 py-2.5 text-end">{t('topRevenue')}</th></tr>
            </thead>
            <tbody>
              {a.topCourses.map((c) => (
                <tr key={c.title} className="border-t border-border">
                  <td className="px-4 py-2.5">{c.title}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{c.sales}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{money(c.revenueDzd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
