import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CalendarDays, Sparkles } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { EventsExplorer } from '@/components/features/events/events-explorer';
import { listEvents } from '@/server/bookings/event-catalog';
import { getEventAttendance } from '@/server/bookings/service';
import { algerianCities } from '@/config/cities';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.events');
  return { title: t('title'), description: t('subtitle') };
}

export default async function EventsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const events = await listEvents();

  const attendanceEntries = await Promise.all(
    events.map(async (e) => [e.id, (await getEventAttendance(e.id)).taken] as const),
  );
  const attendance = Object.fromEntries(attendanceEntries);

  const inventoryCities = new Set(events.map((e) => e.city));
  const cities = algerianCities
    .filter((c) => inventoryCities.has(c.nameEn))
    .map((c) => ({ code: c.code, name: c.nameEn }));

  // "Next event" callout — soonest upcoming.
  const now = Date.now();
  const upcoming = events
    .filter((e) => Date.parse(e.eventDate) > now)
    .sort((a, b) => Date.parse(a.eventDate) - Date.parse(b.eventDate));
  const next = upcoming[0];
  const daysToNext = next
    ? Math.max(0, Math.ceil((Date.parse(next.eventDate) - now) / 86_400_000))
    : null;

  return (
    <>
      <EventsHero upcomingCount={upcoming.length} daysToNext={daysToNext} />
      <section className="border-y border-border/60 bg-muted/20 py-6">
        <Container>
          <Stats events={events} cityCount={cities.length} />
        </Container>
      </section>
      <section className="py-10 sm:py-14">
        <Container>
          <EventsExplorer events={events} cities={cities} attendance={attendance} />
        </Container>
      </section>
    </>
  );
}

function EventsHero({
  upcomingCount,
  daysToNext,
}: {
  upcomingCount: number;
  daysToNext: number | null;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border/60 bg-foreground text-background">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_30%,_rgba(34,197,94,0.18),_transparent_45%),radial-gradient(circle_at_80%_70%,_rgba(99,102,241,0.18),_transparent_45%)]"
      />
      <Container>
        <div className="py-16 sm:py-24">
          <Badge
            variant="primary"
            className="gap-1 border-primary-300 bg-primary-50/10 text-primary-100"
          >
            <CalendarDays className="size-3" />
            Events marketplace
          </Badge>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Pitch nights, demo days, and meetups across Algeria.
          </h1>
          <p className="mt-5 max-w-2xl text-balance text-base text-background/70 sm:text-lg">
            Real rooms, real founders, real investors. Reserve your seat in
            seconds — your wallet handles the rest.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline" className="gap-1.5 border-background/30 bg-background/10 text-background">
              <Sparkles className="size-3" />
              {upcomingCount} upcoming event{upcomingCount === 1 ? '' : 's'}
            </Badge>
            {daysToNext != null && (
              <Badge variant="warning" className="gap-1">
                Next event {daysToNext === 0 ? 'today' : `in ${daysToNext} day${daysToNext === 1 ? '' : 's'}`}
              </Badge>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

function Stats({
  events,
  cityCount,
}: {
  events: Awaited<ReturnType<typeof listEvents>>;
  cityCount: number;
}) {
  const hosts = new Set(events.map((e) => e.incubatorId)).size;
  const free = events.filter((e) => e.price === 0).length;
  const items = [
    { label: 'Events', value: events.length },
    { label: 'Hosts', value: hosts },
    { label: 'Cities', value: cityCount },
    { label: 'Free entry', value: free },
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
