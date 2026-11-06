'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import type { CourseQuote } from '@/lib/academy';
import { formatDzd } from './format';
import { WishlistButton } from './wishlist-button';

interface Me { signedIn: boolean; canBuy: boolean; owned: boolean; viaPass: boolean; premium: boolean; quote: CourseQuote; courseId: string; wishlisted: boolean }

/**
 * The buy button, personalised: "Continue" for an owner, the member's own price
 * for a Premium member. The rest of the course page stays cacheable.
 */
export function CourseCta({ slug }: { slug: string }) {
  const t = useTranslations('academy');
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiClient.get<Me>(`/academy/courses/${slug}/me`).then(setMe).catch(() => setMe(null));
  }, [slug]);

  const giftLink = (
    <Link href={{ pathname: '/academy/checkout', query: { course: slug, gift: '1' } }} className="flex items-center justify-center gap-1.5 py-1 text-sm font-semibold text-primary hover:underline">
      <Gift className="size-4" aria-hidden />{t('gift.offerCourse')}
    </Link>
  );

  if (me?.owned || me?.viaPass) {
    return (
      <div className="space-y-2">
        <Button asChild size="lg" className="w-full font-bold">
          <Link href={`/academy/learn/${slug}`}>{me.owned ? t('course.continue') : t('course.watchWithPass')}</Link>
        </Button>
        {me.signedIn && me.canBuy && giftLink}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {me?.premium && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t('course.yourPrice', { price: formatDzd(me.quote.amountDzd, locale) })}
        </p>
      )}
      <Button asChild size="lg" className="w-full font-bold" disabled={me ? !me.canBuy : false}>
        <Link href={{ pathname: '/academy/checkout', query: { course: slug } }}>{t('course.buy')}</Link>
      </Button>
      {me && !me.canBuy && <p className="text-xs text-muted-foreground">{t('checkout.errors.NOT_A_BUYER')}</p>}
      {me?.signedIn && <WishlistButton courseId={me.courseId} initial={me.wishlisted} />}
      {me?.signedIn && me.canBuy && giftLink}
    </div>
  );
}
