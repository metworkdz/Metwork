'use client';

/**
 * Client-side promo code widget shown on the membership upgrade page.
 * Payment buttons are intentionally disabled until the billing flow ships,
 * so this component is visual-only — it lets the user validate a promo
 * code and see the discounted price for the next tier.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PromoCodeInput, type PromoResult } from '@/components/shared/promo-code-input';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

interface MembershipPromoSectionProps {
  /** Monthly price (DZD) of the tier the user can upgrade to next. */
  nextTierPrice: number;
  /** Next tier display name, e.g. "Entrepreneur". */
  nextTierName: string;
  locale: Locale;
}

export function MembershipPromoSection({
  nextTierPrice,
  nextTierName,
  locale,
}: MembershipPromoSectionProps) {
  const t = useTranslations('membership.promoSection');
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  if (nextTierPrice === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
      <p className="text-sm font-medium">{t('havePromoCode')}</p>
      <PromoCodeInput
        originalAmount={nextTierPrice}
        onApplied={setPromoResult}
      />
      {promoResult && (
        <p className="text-sm text-emerald-700">
          {t('planWouldBe', {
            planName: nextTierName,
            price: promoResult.finalAmount === 0
              ? t('free')
              : `${formatCurrency(promoResult.finalAmount, locale)}${t('perMonth')}`,
          })}
        </p>
      )}
    </div>
  );
}
