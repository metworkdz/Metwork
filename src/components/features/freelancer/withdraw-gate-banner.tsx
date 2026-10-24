import { getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { Link } from '@/i18n/routing';
import type { WithdrawBlock } from '@/server/freelancer-contracts/service';

/** Wallet notice while a freelancer can't withdraw yet, with the one next step. */
export async function WithdrawGateBanner({ block }: { block: WithdrawBlock }) {
  const t = await getTranslations('freelancerContract.gate');
  const profile = block === 'PROFILE_INCOMPLETE';
  return (
    <section className="flex items-center gap-3 rounded-[1.25rem] border border-amber-300 bg-amber-50/70 p-4 dark:bg-amber-500/10">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
        <Lock className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{profile ? t('profile') : t('contract')}</p>
      </div>
      <Link
        href={profile ? '/dashboard/freelancer/profile' : '/dashboard/freelancer/contract'}
        className="flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
      >
        {profile ? t('profileCta') : t('contractCta')}
      </Link>
    </section>
  );
}
