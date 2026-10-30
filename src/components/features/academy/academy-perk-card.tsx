import { getTranslations } from 'next-intl/server';
import { GraduationCap } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { db } from '@/server/db/store';
import { getAcademyPricing } from '@/server/academy/settings';
import { isAcademyEnabled } from '@/config/feature-flags';
import { isAcademyPremium } from '@/lib/academy';
import type { UserRecord } from '@/server/db/store';
import { formatDzd } from './format';

/** The Academy discount among a Premium member's perks, with what it already saved them. */
export async function AcademyPerkCard({ user, locale }: { user: UserRecord; locale: string }) {
  if (!isAcademyEnabled() || !isAcademyPremium(user)) return null;
  const t = await getTranslations('academy.perk');
  const tm = await getTranslations('academy');
  const [pricing, d] = await Promise.all([getAcademyPricing(), db.read()]);
  const saved = (d.academyOrders ?? [])
    .filter((o) => o.userId === user.id && o.status === 'PAID' && !o.duplicateRefunded)
    .reduce((s, o) => s + (o.listPriceDzd - o.amountDzd), 0);
  return (
    <section className="flex flex-col gap-4 rounded-2xl p-6 text-white sm:flex-row sm:items-center" style={{ background: 'linear-gradient(140deg,#0E3B1E,#04150C)' }}>
      <GraduationCap className="size-10 shrink-0 text-[#2ECC71]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#2ECC71]">{t('eyebrow')}</p>
        <p className="mt-1 font-display text-2xl font-extrabold">{t('title', { percent: Math.round(pricing.premiumDiscountRate * 100) })}</p>
        <p className="mt-1 text-sm text-white/75">{saved > 0 ? t('saved', { amount: tm('money', { price: formatDzd(saved, locale) }) }) : t('desc')}</p>
      </div>
      <Button asChild className="bg-white font-bold text-[#04150C] hover:bg-white/90"><Link href="/academy">{t('cta')}</Link></Button>
    </section>
  );
}
