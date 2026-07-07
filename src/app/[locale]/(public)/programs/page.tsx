import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Flame, Sparkles } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { ProgramsExplorer } from '@/components/features/programs/programs-explorer';
import { listPrograms } from '@/server/bookings/program-catalog';
import { getProgramAttendance } from '@/server/bookings/service';
import { algerianCities } from '@/config/cities';
import { assertLandingVisible } from '@/lib/landing-visibility';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.programs');
  return { title: t('title'), description: t('subtitle') };
}

export default async function ProgramsPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('programs');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.programs');

  const programs = await listPrograms();

  // Live attendance map keyed by program id (bookings are the source of truth).
  const attendanceEntries = await Promise.all(
    programs.map(async (p) => [p.id, (await getProgramAttendance(p.id)).taken] as const),
  );
  const attendance = Object.fromEntries(attendanceEntries);

  // Build the city facet from inventory, ordered by canonical city list.
  const inventoryCities = new Set(programs.map((p) => p.city));
  const cities = algerianCities
    .filter((c) => inventoryCities.has(c.nameEn))
    .map((c) => ({ code: c.code, name: c.nameEn }));

  // Quick stat: how many cohorts are accepting applications right now.
  const now = Date.now();
  const openNow = programs.filter((p) => {
    const taken = attendance[p.id] ?? p.seatsTaken;
    return Date.parse(p.deadline) > now && taken < p.seatsTotal;
  }).length;

  // Closing-soonest open program for the urgency callout.
  const closingNext = programs
    .filter((p) => {
      const taken = attendance[p.id] ?? p.seatsTaken;
      return Date.parse(p.deadline) > now && taken < p.seatsTotal;
    })
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))[0];
  const closingDays = closingNext
    ? Math.ceil((Date.parse(closingNext.deadline) - now) / 86_400_000)
    : null;

  const cohortsBadge = openNow === 1 ? t('cohortsAcceptingOne') : t('cohortsAcceptingMany', { count: openNow });
  const deadlineBadge = closingDays != null && closingDays <= 14
    ? closingDays === 1
      ? t('deadlineClosingOne')
      : t('deadlineClosingMany', { count: closingDays })
    : null;

  const hosts = new Set(programs.map((p) => p.incubatorId)).size;
  const free = programs.filter((p) => p.price === 0).length;
  const statsItems = [
    { label: t('statsPrograms'), value: programs.length },
    { label: t('statsHosts'),    value: hosts },
    { label: t('statsCities'),   value: cities.length },
    { label: t('statsFree'),     value: free },
  ];

  return (
    <>
      <ProgramsHero
        eyebrow={t('heroEyebrow')}
        headline={t('heroHeadline')}
        subheadline={t('heroSubheadline')}
        cohortsBadge={cohortsBadge}
        deadlineBadge={deadlineBadge}
      />
      <section className="border-y border-border/60 bg-muted/20 py-6">
        <Container>
          <Stats items={statsItems} />
        </Container>
      </section>
      <section className="py-10 sm:py-14">
        <Container>
          <ProgramsExplorer
            programs={programs}
            cities={cities}
            attendance={attendance}
          />
        </Container>
      </section>
    </>
  );
}

function ProgramsHero({
  eyebrow,
  headline,
  subheadline,
  cohortsBadge,
  deadlineBadge,
}: {
  eyebrow: string;
  headline: string;
  subheadline: string;
  cohortsBadge: string;
  deadlineBadge: string | null;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border/60 bg-foreground text-background">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_20%,_rgba(34,197,94,0.18),_transparent_45%),radial-gradient(circle_at_85%_80%,_rgba(99,102,241,0.18),_transparent_45%)]"
      />
      <Container>
        <div className="py-16 sm:py-24">
          <Badge
            variant="primary"
            className="gap-1 border-primary-300 bg-primary-50/10 text-primary-100"
          >
            <Flame className="size-3" />
            {eyebrow}
          </Badge>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-2xl text-balance text-base text-background/70 sm:text-lg">
            {subheadline}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline" className="gap-1.5 border-background/30 bg-background/10 text-background">
              <Sparkles className="size-3" />
              {cohortsBadge}
            </Badge>
            {deadlineBadge != null && (
              <Badge variant="warning" className="gap-1">
                {deadlineBadge}
              </Badge>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

function Stats({ items }: { items: { label: string; value: number }[] }) {
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
