'use client';

/**
 * Slide-out detail panel for a single space. Holds the inline booking
 * form and switches to a success panel after a successful booking.
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Check, MapPin, Star, Users } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetClose,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SpaceImage } from './space-image';
import { categoryLabel } from './space-meta';
import {
  SpaceBookingForm,
  BookingSuccessPanel,
} from './space-booking-form';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Space } from '@/types/domain';
import type { BookingDto } from '@/types/booking';

interface SpaceDetailSheetProps {
  space: Space | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SpaceDetailSheet({ space, open, onOpenChange }: SpaceDetailSheetProps) {
  const locale = useLocale() as Locale;
  const [success, setSuccess] = useState<{ booking: BookingDto; newBalance: number } | null>(null);

  // Reset success state whenever the space changes or the sheet closes.
  useEffect(() => {
    if (!open) setSuccess(null);
  }, [open]);
  useEffect(() => {
    setSuccess(null);
  }, [space?.id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {space ? (
          <>
            <div className="relative h-56 w-full shrink-0">
              <SpaceImage category={space.category} imageUrl={space.imageUrl} alt={space.name} />
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
              <Badge variant="outline">{categoryLabel[space.category]}</Badge>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">{space.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {space.city} · {space.incubatorName}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" />
                  Up to {space.capacity}
                </span>
                {space.rating != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 fill-amber-400 stroke-amber-400" />
                    <span className="font-medium text-foreground">
                      {space.rating.toFixed(1)}
                    </span>
                    <span>· {space.reviewCount} reviews</span>
                  </span>
                )}
              </div>

              <p className="mt-5 text-sm leading-relaxed text-foreground">
                {space.description}
              </p>

              {space.amenities.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    What&apos;s included
                  </p>
                  <ul className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                    {space.amenities.map((a) => (
                      <li key={a} className="inline-flex items-center gap-2">
                        <Check className="size-3.5 text-primary-600" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pricing
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <PriceTile label="Hour" value={space.pricePerHour} locale={locale} />
                  <PriceTile label="Day" value={space.pricePerDay} locale={locale} />
                  <PriceTile label="Month" value={space.pricePerMonth} locale={locale} />
                </div>
              </div>

              <div className="my-6 border-t border-border" />

              {success ? (
                <div className="space-y-4">
                  <BookingSuccessPanel
                    booking={success.booking}
                    newBalance={success.newBalance}
                  />
                  <SheetClose asChild>
                    <Button variant="outline" className="w-full">
                      Close
                    </Button>
                  </SheetClose>
                </div>
              ) : (
                <SpaceBookingForm
                  space={space}
                  onSuccess={(booking, newBalance) => setSuccess({ booking, newBalance })}
                />
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PriceTile({
  label,
  value,
  locale,
}: {
  label: string;
  value: number | null;
  locale: Locale;
}) {
  if (value == null) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
        <p>{label}</p>
        <p className="mt-0.5">—</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">
        {formatCurrency(value, locale)}
      </p>
    </div>
  );
}
