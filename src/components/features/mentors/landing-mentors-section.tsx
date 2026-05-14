/**
 * "Our Mentors" landing section. Server component — fetches the live
 * roster directly via the service so the first paint includes the cards
 * (no client-side loading flash). Renders nothing when the roster is
 * empty so the landing page stays clean for fresh installs.
 */
import { getTranslations } from 'next-intl/server';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { listMentors } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { MentorsCarousel } from './mentors-carousel';

export async function LandingMentorsSection() {
  const mentors = (await listMentors()).map(toMentorDto);
  if (mentors.length === 0) return null;

  const t = await getTranslations('mentors.landing');

  return (
    <section className="border-y border-border/60 bg-muted/30 py-20 sm:py-28">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <Badge variant="primary" className="gap-1">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary-500" />
              </span>
              {t('badge')}
            </Badge>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('title')}
            </h2>
            <p className="mt-3 text-balance text-base text-muted-foreground">
              {t('description')}
            </p>
          </div>
        </div>

        <div className="mt-10">
          <MentorsCarousel mentors={mentors} />
        </div>
      </Container>
    </section>
  );
}
