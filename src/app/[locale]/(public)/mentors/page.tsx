import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ArrowRight, Star } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MentorSlideshow } from '@/components/features/mentors/mentor-slideshow';
import { listMentors } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata: Metadata = {
  title: 'Mentors — Metwork',
  description:
    'Meet the founders and operators who mentor the next generation of Algerian startups. Book a consultation today.',
};

export default async function MentorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const mentors = (await listMentors()).map(toMentorDto);

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50 via-background to-background"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary-100/60 via-transparent to-transparent"
        />

        <Container>
          <div className="flex flex-col items-center pb-12 pt-12 text-center sm:pb-20 sm:pt-24">
            <Badge variant="primary" className="gap-1.5">
              <Star className="size-3" />
              Our mentor network
            </Badge>

            <h1 className="mt-5 max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-6xl">
              Learn from founders
              <br className="hidden sm:block" />
              <span className="text-primary"> who&apos;ve done it.</span>
            </h1>

            <p className="mt-5 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              Our mentors are hand-picked operators, investors, and founders who
              have built and scaled Algeria&apos;s most impactful startups. Get
              direct access — book a one-on-one consultation.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="group">
                <a href="#mentors">
                  Meet the mentors
                  <ArrowRight className="ms-1 size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/signup">Join as a founder</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Slideshow ── */}
      <section id="mentors" className="scroll-mt-20 py-10 sm:py-20">
        <Container size="md">
          <MentorSlideshow mentors={mentors} />
        </Container>
      </section>

      {/* ── Stats strip ── */}
      {mentors.length > 0 && (
        <section className="border-y border-border/60 bg-muted/30 py-10">
          <Container>
            <dl className="grid grid-cols-3 gap-6 text-center">
              <div>
                <dd className="text-3xl font-semibold tracking-tight text-foreground">
                  {mentors.length}+
                </dd>
                <dt className="mt-1 text-sm text-muted-foreground">Expert mentors</dt>
              </div>
              <div>
                <dd className="text-3xl font-semibold tracking-tight text-foreground">1:1</dd>
                <dt className="mt-1 text-sm text-muted-foreground">Sessions available</dt>
              </div>
              <div>
                <dd className="text-3xl font-semibold tracking-tight text-foreground">48h</dd>
                <dt className="mt-1 text-sm text-muted-foreground">Response time</dt>
              </div>
            </dl>
          </Container>
        </section>
      )}

      {/* ── CTA ── */}
      <section className="py-20 sm:py-28">
        <Container size="lg">
          <div className="relative overflow-hidden rounded-2xl bg-primary-700 px-5 py-12 text-center sm:rounded-3xl sm:px-12 sm:py-20">
            {/* Decorative blobs */}
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.12),_transparent_55%)]"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(255,255,255,0.08),_transparent_55%)]"
            />

            <div className="relative">
              <Badge className="border-white/20 bg-white/10 text-white">
                Work with the best
              </Badge>
              <h2 className="mx-auto mt-4 max-w-2xl text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl md:text-4xl">
                Get guidance from Algeria&apos;s top startup operators.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-balance text-primary-100">
                Whether you&apos;re pre-revenue or scaling to your first million —
                our mentors have navigated the same challenges. One session can
                change your trajectory.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Button
                  asChild
                  size="xl"
                  className="bg-white text-primary-700 hover:bg-primary-50"
                >
                  <Link href="/signup">
                    Join and book a session
                    <ArrowRight className="ms-1 size-4 rtl:rotate-180" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="xl"
                  variant="outline"
                  className="border-white/30 bg-transparent text-white hover:bg-white/10"
                >
                  <Link href="/contact">Get in touch</Link>
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
