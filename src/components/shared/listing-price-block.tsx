'use client';

/**
 * ListingPriceBlock — THE price display for a PROGRAM or EVENT.
 *
 * A listing can be priced differently per payment surface (`onlinePrice` vs
 * `cashPrice`). Every surface that shows a price used to render the base
 * `price` field, so a host who set 22 000 by card / 24 000 in cash saw one
 * number in both places while the server charged the other. This component is
 * the single answer: it resolves both surfaces through `resolveListingPricing`
 * — the same function the settlement path uses — and renders whichever the
 * listing actually accepts.
 *
 * `variant`:
 *   • 'hero' — the big number on a public detail page.
 *   • 'tile' — the compact value inside a detail tile / card row.
 */
import { useLocale, useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/format';
import { resolveListingPricing } from '@/lib/listing-price';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { PaymentMethod } from '@/types/domain';

interface ListingPriceBlockProps {
  /** Base price (integer DZD). */
  price: number;
  /** Optional per-surface overrides. */
  onlinePrice?: number | null;
  cashPrice?: number | null;
  /** Which surfaces the listing accepts. Defaults to online-only. */
  acceptedPaymentMethods?: PaymentMethod[] | null;
  variant?: 'hero' | 'tile';
  /** Caption under a single price (e.g. "Enrollment fee"). Hero only. */
  caption?: string;
  className?: string;
}

export function ListingPriceBlock({
  price,
  onlinePrice,
  cashPrice,
  acceptedPaymentMethods,
  variant = 'hero',
  caption,
  className,
}: ListingPriceBlockProps) {
  const t = useTranslations('listingPrice');
  const locale = useLocale() as Locale;

  const pricing = resolveListingPricing(price, { onlinePrice, cashPrice });
  const methods = acceptedPaymentMethods?.length ? acceptedPaymentMethods : ['ONLINE' as const];
  const takesOnline = methods.includes('ONLINE');
  const takesCash = methods.includes('CASH');

  const isFree = pricing.online === 0 && pricing.cash === 0;
  // Two numbers are worth showing only when the host set them apart AND the
  // visitor can actually choose between the two surfaces.
  const showBoth = !isFree && pricing.differs && takesOnline && takesCash;

  if (isFree) {
    return variant === 'hero' ? (
      <div className={cn('text-center', className)}>
        <p className="text-3xl font-bold text-emerald-600">{t('free')}</p>
      </div>
    ) : (
      <span className={cn('text-emerald-600', className)}>{t('free')}</span>
    );
  }

  // Single price — either no split configured, or only one surface accepted.
  if (!showBoth) {
    const single = takesOnline ? pricing.online : pricing.cash;
    return variant === 'hero' ? (
      <div className={cn('text-center', className)}>
        <p className="text-3xl font-bold tabular-nums">{formatCurrency(single, locale)}</p>
        {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      </div>
    ) : (
      <span className={cn('tabular-nums', className)}>{formatCurrency(single, locale)}</span>
    );
  }

  if (variant === 'tile') {
    return (
      <span className={cn('tabular-nums', className)}>
        {t('byCard', { amount: formatCurrency(pricing.online, locale) })}
        <span className="block text-xs font-normal text-muted-foreground">
          {t('inCash', { amount: formatCurrency(pricing.cash, locale) })}
        </span>
      </span>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-2 text-center', className)}>
      <PriceCell
        amount={formatCurrency(pricing.online, locale)}
        label={t('payingByCard')}
        highlight={pricing.online <= pricing.cash}
      />
      <PriceCell
        amount={formatCurrency(pricing.cash, locale)}
        label={t('payingInCash')}
        highlight={pricing.cash < pricing.online}
      />
    </div>
  );
}

function PriceCell({
  amount,
  label,
  highlight,
}: {
  amount: string;
  label: string;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-2 py-2.5',
        highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30',
      )}
    >
      <p
        className={cn(
          'text-lg font-bold tabular-nums leading-tight',
          highlight ? 'text-primary' : 'text-foreground',
        )}
      >
        {amount}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
