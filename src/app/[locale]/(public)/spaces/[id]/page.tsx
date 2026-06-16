import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MapPin, Users, Clock, Building2, ArrowLeft } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { findSpaceById } from '@/server/bookings/space-catalog';
import { SpacePublicBookingCTA } from '@/components/features/spaces/space-public-booking-cta';
import { ImageCarousel } from '@/components/shared/image-carousel';
import { categoryLabel } from '@/components/features/spaces/space-meta';
import type { SpaceCategory } from '@/types/domain';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const space = await findSpaceById(id);
  if (!space) return { title: 'Space not found' };
  return {
    title: `${space.name} — ${space.incubatorName}`,
    description: space.description,
  };
}

export default async function SpaceDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('spaces.detail');

  const space = await findSpaceById(id);
  if (!space) notFound();

  const galleryImages = space.imageUrls?.length
    ? space.imageUrls
    : (space.imageUrl ? [space.imageUrl] : []);

  const prices: { label: string; value: number }[] = [];
  if (space.pricePerHour != null) prices.push({ label: t('hourLabel'), value: space.pricePerHour });
  if (space.pricePerHalfDay != null) prices.push({ label: t('halfDayLabel'), value: space.pricePerHalfDay });
  if (space.pricePerDay != null) prices.push({ label: t('dayLabel'), value: space.pricePerDay });
  if (space.pricePerMonth != null) prices.push({ label: t('monthLabel'), value: space.pricePerMonth });

  return (
    <Container className="py-10 sm:py-14">
      {/* Back link */}
      <Link
        href="/spaces"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('backLink')}
      </Link>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Left: image + meta */}
        <div className="lg:col-span-3 space-y-6">
          {/* Image gallery */}
          {galleryImages.length > 0 ? (
            <ImageCarousel images={galleryImages} alt={space.name} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-muted aspect-video">
              <div className="flex size-full items-center justify-center">
                <Building2 className="size-12 text-muted-foreground/30" />
              </div>
            </div>
          )}

          {/* Badges + title */}
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="primary">{categoryLabel[space.category as SpaceCategory]}</Badge>
              <Badge variant="outline" className="gap-1">
                <MapPin className="size-3" />{space.city}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Users className="size-3" />{t('seats', { count: space.capacity })}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{space.name}</h1>
            <p className="mt-1 text-muted-foreground">{space.incubatorName}</p>
          </div>

          {/* Description */}
          {space.description && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{space.description}</p>
          )}

          {/* Amenities */}
          {space.amenities.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t('amenities')}</p>
              <div className="flex flex-wrap gap-2">
                {space.amenities.map((a) => (
                  <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: pricing + booking CTA */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-4 rounded-2xl border border-border bg-card p-6">
            {/* Pricing */}
            {prices.length > 0 && (
              <div className="space-y-2">
                {prices.map((p) => (
                  <div key={p.label} className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3.5" />{p.label}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {formatCurrency(p.value, locale as Locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {prices.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('contactForPricing')}</p>
            )}

            <div className="border-t border-border pt-4">
              <SpacePublicBookingCTA space={space} locale={locale} />
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {t('paymentNote')}
            </p>
          </div>
        </div>
      </div>
    </Container>
  );
}
