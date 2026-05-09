import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { SpacesPageClient } from '@/components/features/spaces/spaces-page-client';
import { demoPublicSpaces } from '@/lib/demo-data';
import { algerianCities } from '@/config/cities';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.spaces');
  return {
    title: t('title'),
    description: t('subtitle'),
  };
}

export default async function SpacesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // TODO: replace with `await spacesService.list()` when the listings API ships.
  const spaces = demoPublicSpaces;

  // Build the city facet from the space inventory, then re-order using
  // the canonical city list for predictable display.
  const inventoryCityNames = new Set(spaces.map((s) => s.city));
  const cities = algerianCities
    .filter((c) => inventoryCityNames.has(c.nameEn))
    .map((c) => ({ code: c.code, name: c.nameEn }));

  return <SpacesPageClient spaces={spaces} cities={cities} />;
}
