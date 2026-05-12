'use client';

/**
 * User-facing component — display the membership discount that has been
 * applied via a partner promo code.
 *
 * Typically rendered on the membership upgrade / checkout page after
 * `PromoCodeInput` calls `onApplied`.
 *
 * Usage:
 *   <DiscountDisplay
 *     originalPrice={12000}
 *     discountPercentage={50}
 *     membershipTier="BUILDER"
 *     currency="DZD"
 *   />
 */

import { Tag } from 'lucide-react';

type MembershipTier = 'BUILDER' | 'FOUNDER';

interface Props {
  /** Full (undiscounted) price in the given currency. */
  originalPrice: number;
  /** 1–99 — the partner discount percentage. */
  discountPercentage: number;
  /** Tier being discounted. */
  membershipTier: MembershipTier;
  /** Currency label, e.g. "DZD". Default "DZD". */
  currency?: string;
  /** Name of the partner space that issued the code. Optional. */
  partnerName?: string;
}

export function DiscountDisplay({
  originalPrice,
  discountPercentage,
  membershipTier,
  currency = 'DZD',
  partnerName,
}: Props) {
  const discountAmount = Math.round(originalPrice * (discountPercentage / 100));
  const finalPrice = Math.max(0, originalPrice - discountAmount);
  const tierLabel = membershipTier === 'FOUNDER' ? 'Founder' : 'Builder';

  const fmt = (n: number) => `${n.toLocaleString()} ${currency}`;

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Tag className="h-4 w-4 text-green-700" />
        <span className="text-sm font-semibold text-green-800">
          Partner discount applied
          {partnerName ? ` · ${partnerName}` : ''}
        </span>
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-zinc-600">
          <span>{tierLabel} membership (1 year)</span>
          <span className="line-through text-zinc-400">{fmt(originalPrice)}</span>
        </div>
        <div className="flex justify-between font-medium text-green-800">
          <span>Discount ({discountPercentage}% off)</span>
          <span>− {fmt(discountAmount)}</span>
        </div>
        <div className="flex justify-between border-t border-green-200 pt-2 text-base font-bold text-green-900">
          <span>Total</span>
          <span>{fmt(finalPrice)}</span>
        </div>
      </div>
    </div>
  );
}
