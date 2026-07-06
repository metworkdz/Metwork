import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  MapPin, Users, Clock, Building2, ArrowLeft, ChevronRight,
  Ruler, Layers, Wifi, Coffee, Printer, Car, Snowflake, Phone, Lock, Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { findSpaceById } from '@/server/bookings/space-catalog';
import { getDomiciliationAvailability } from '@/server/spaces/availability';
import { SpacePublicBookingCTA } from '@/components/features/spaces/space-public-booking-cta';
import { CoworkingBookingPanel } from '@/components/features/spaces/coworking-booking-panel';
import { DomiciliationRequestPanel } from '@/components/features/spaces/domiciliation-request-panel';
import { OfficeGallery } from '@/components/features/spaces/office-gallery';
import { ImageCarousel } from '@/components/shared/image-carousel';
import { categoryLabel } from '@/components/features/spaces/space-meta';
import type { SpaceCategory } from '@/types/domain';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { assertLandingVisible } from '@/lib/landing-visibility';

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

/** Best-effort lucide icon for a free-text amenity; falls back to a check. */
function amenityIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes('wifi') || n.includes('internet')) return Wifi;
  if (n.includes('coffee') || n.includes('café') || n.includes('cafe') || n.includes('kitchen')) return Coffee;
  if (n.includes('print') || n.includes('scan')) return Printer;
  if (n.includes('park')) return Car;
  if (n.includes('air') || n.includes('clim') || n.includes('ac')) return Snowflake;
  if (n.includes('phone') || n.includes('call')) return Phone;
  if (n.includes('secur') || n.includes('lock') || n.includes('access')) return Lock;
  if (n.includes('meeting') || n.includes('seat') || n.includes('desk')) return Users;
  return Check;
}

export default async function SpaceDetailPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('spaces');
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('spaces.detail');

  const space = await findSpaceById(id);
  if (!space) notFound();

  const category = space.category as SpaceCategory;
  const isCoworking = category === 'COWORKING';
  const isOffice = category === 'PRIVATE_OFFICE';
  const isDomiciliation = category === 'DOMICILIATION';

  const galleryImages = space.imageUrls?.length
    ? space.imageUrls
    : (space.imageUrl ? [space.imageUrl] : []);
  const officePhotos = space.officePhotos?.length ? space.officePhotos : galleryImages;
  const officeAmenities = space.officeAmenities?.length ? space.officeAmenities : space.amenities;

  const prices: { label: string; value: number }[] = [];
  if (space.pricePerHour != null) prices.push({ label: t('hourLabel'), value: space.pricePerHour });
  if (space.pricePerHalfDay != null) prices.push({ label: t('halfDayLabel'), value: space.pricePerHalfDay });
  if (space.pricePerDay != null) prices.push({ label: t('dayLabel'), value: space.pricePerDay });
  if (space.pricePerMonth != null) prices.push({ label: t('monthLabel'), value: space.pricePerMonth });

  // DOMICILIATION availability counter (canonical module).
  const domAvailability = isDomiciliation ? await getDomiciliationAvailability(id) : null;

  const PricesBlock = prices.length > 0
    ? (
      <div className="space-y-2">
        {prices.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between">
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="size-3.5" />{p.label}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(p.value, locale as Locale)}
            </span>
          </div>
        ))}
      </div>
    )
    : <p className="text-sm text-muted-foreground">{t('contactForPricing')}</p>;

  return (
    <Container className="py-10 sm:py-14">
      {/* Breadcrumb: Spaces → {Space name} */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/spaces" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <ArrowLeft className="size-4" />
              {t('backLink')}
            </Link>
          </li>
          <li aria-hidden><ChevronRight className="size-3.5 rtl:rotate-180" /></li>
          <li className="truncate font-medium text-foreground">{space.name}</li>
        </ol>
      </nav>

      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-5">
        {/* ── Left column: gallery + meta ── */}
        <div className="space-y-6 lg:col-span-3">
          {isOffice ? (
            <OfficeGallery photos={officePhotos} alt={space.name} />
          ) : galleryImages.length > 0 ? (
            <ImageCarousel images={galleryImages} alt={space.name} />
          ) : (
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
              <Building2 className="size-12 text-muted-foreground/30" />
            </div>
          )}

          {/* Badges + title */}
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge variant="primary">{categoryLabel[category]}</Badge>
              <Badge variant="outline" className="gap-1">
                <MapPin className="size-3" />{space.city}
              </Badge>
              {!isDomiciliation && (
                <Badge variant="outline" className="gap-1">
                  <Users className="size-3" />{t('seats', { count: space.capacity })}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{space.name}</h1>
            <p className="mt-1 text-muted-foreground">{space.incubatorName}</p>
          </div>

          {/* Description */}
          {space.description && (
            <p className="leading-relaxed whitespace-pre-line text-muted-foreground">{space.description}</p>
          )}

          {/* PRIVATE_OFFICE: office details (area / floor / amenity chips) */}
          {isOffice && (
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('officeDetails')}
              </p>
              <div className="flex flex-wrap gap-6">
                {space.officeSize != null && (
                  <div className="flex items-center gap-2">
                    <Ruler className="size-4 text-primary" />
                    <span className="text-sm">
                      <span className="text-muted-foreground">{t('officeArea')}: </span>
                      <span className="font-medium">{space.officeSize} m²</span>
                    </span>
                  </div>
                )}
                {space.officeFloor && (
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-primary" />
                    <span className="text-sm">
                      <span className="text-muted-foreground">{t('officeFloor')}: </span>
                      <span className="font-medium">{space.officeFloor}</span>
                    </span>
                  </div>
                )}
              </div>
              {officeAmenities.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {officeAmenities.map((a) => {
                    const Icon = amenityIcon(a);
                    return (
                      <span
                        key={a}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs"
                      >
                        <Icon className="size-3.5 text-primary" />
                        {a}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Amenities (non-office categories) */}
          {!isOffice && space.amenities.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('amenities')}</p>
              <div className="flex flex-wrap gap-2">
                {space.amenities.map((a) => (
                  <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: category-specific booking panel ── */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-4 rounded-2xl border border-border bg-card p-6">
            {isDomiciliation ? (
              <>
                {space.pricePerMonth != null && (
                  <div className="flex items-baseline justify-between border-b border-border pb-4">
                    <span className="text-sm text-muted-foreground">{t('domPriceLabel')}</span>
                    <span className="text-lg font-semibold tabular-nums">
                      {formatCurrency(space.pricePerMonth, locale as Locale)}
                      <span className="ms-1 text-xs font-normal text-muted-foreground">{t('domPriceSuffix')}</span>
                    </span>
                  </div>
                )}
                <DomiciliationRequestPanel
                  spaceId={space.id}
                  availability={domAvailability ?? { total: 0, used: 0, available: 0 }}
                />
              </>
            ) : (
              <>
                {PricesBlock}
                <div className="border-t border-border pt-4">
                  {isCoworking
                    ? <CoworkingBookingPanel space={space} />
                    : <SpacePublicBookingCTA space={space} locale={locale} />}
                </div>
                <p className="text-center text-xs text-muted-foreground">{t('paymentNote')}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}
