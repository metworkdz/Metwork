import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2 } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { SpacesExplorer } from '@/components/features/spaces/spaces-explorer';
import { demoPublicSpaces } from '@/lib/demo-data';
import { algerianCities } from '@/config/cities';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.spaces');
  return { title: t('title'), description: t('subtitle') };
}

export default async function SpacesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // TODO: replace with `await spacesService.list()` when the listings API ships.
  const spaces = demoPublicSpaces;

  // Build the city facet from the inventory itself, then re-order using
  // the canonical city list for predictable display.
  const inventoryCityNames = new Set(spaces.map((s) => s.city));
  const cities = algerianCities
    .filter((c) => inventoryCityNames.has(c.nameEn))
    .map((c) => ({ code: c.code, name: c.nameEn }));

  return (
    <>
      <SpacesHero />
      <section className="border-y border-border/60 bg-muted/20 py-6">
        <Container>
          <Stats spaces={spaces} cityCount={cities.length} />
        </Container>
      </section>
      <section className="py-10 sm:py-14">
        <Container>
          <SpacesExplorer spaces={spaces} cities={cities} />
        </Container>
      </section>
    </>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */

function SpacesHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50 via-background to-background"
      />
      <Container>
        <div className="py-14 sm:py-20">
          <Badge variant="primary" className="gap-1">
            <Building2 className="size-3" />
            Spaces marketplace
          </Badge>
          <h1 className="mt-4 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Find your next workspace, anywhere in Algeria.
          </h1>
          <p className="mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            Coworking floors, private offices, training rooms, and business
            domiciliation — bookable by the hour, day, or month, and paid
            from your wallet in one click.
          </p>
        </div>
      </Container>
    </section>
  );
}

/* ─────────────────────────── Quick stats strip ─────────────────────────── */

function Stats({
  spaces,
  cityCount,
}: {
  spaces: typeof demoPublicSpaces;
  cityCount: number;
}) {
  const hosts = new Set(spaces.map((s) => s.incubatorId)).size;
  const items = [
    { label: 'Listings', value: spaces.length },
    { label: 'Cities', value: cityCount },
    { label: 'Hosts', value: hosts },
    { label: 'Categories', value: 4 },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="flex items-baseline gap-2">
          <dd className="text-2xl font-semibold tabular-nums">{s.value}</dd>
          <dt className="text-sm text-muted-foreground">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}
