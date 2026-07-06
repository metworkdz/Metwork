import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  BookOpen,
  GraduationCap,
  Megaphone,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { AcademyNotifyForm } from '@/components/features/academy/academy-notify-form';
import { assertLandingVisible } from '@/lib/landing-visibility';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.academy');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/* ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   COURSE POSTERS DROP ZONE

   The Academy launches as a "coming soon" page — no live course data is wired.
   When you're ready to tease real courses, add entries below. Each renders as a
   3:4 portrait poster card; any remaining slots fall back to a branded
   "coming soon" placeholder so the grid always looks full.

     1. Drop the poster image in  public/assets/academy/  (e.g. growth.jpg)
     2. Add a row here:
          { src: '/assets/academy/growth.jpg', alt: 'Growth & fundraising' }

   Nothing else needs to change.
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ */
const coursePosters: { src: string; alt: string }[] = [];
const MIN_POSTER_SLOTS = 6;

const TRACK_ICONS = [Rocket, TrendingUp, ShieldCheck, Megaphone] as const;
const PILLAR_ICONS = [Users, BookOpen, Sparkles] as const;

export default async function AcademyPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('academy');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.academy');

  const tracks = TRACK_ICONS.map((icon, i) => ({
    icon,
    title: t(`fallback${i + 1}Title`),
    description: t(`fallback${i + 1}Desc`),
  }));

  const pillars = PILLAR_ICONS.map((icon, i) => ({
    icon,
    title: t(`pillar${i + 1}Title`),
    description: t(`pillar${i + 1}Desc`),
  }));

  const placeholderCount = Math.max(0, MIN_POSTER_SLOTS - coursePosters.length);

  return (
    <div className="bg-background">
      {/* ── Hero — coming soon ── */}
      <section className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden border-b border-border/60 bg-background">
        <div aria-hidden className="absolute inset-0 -z-10 bg-dot-grid" />
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[640px] hero-glow" />

        <Container size="xl" className="py-16 sm:py-20">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            {/* Coming-soon badge */}
            <div className="animate-fade-in inline-flex items-center gap-2.5 rounded-full border border-primary-200 bg-primary-50/80 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-primary-700 backdrop-blur-sm">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary-600" />
              </span>
              {t('heroBadge')}
            </div>

            <p
              className="animate-fade-in mt-6 text-xs font-bold uppercase tracking-[0.18em] text-primary"
              style={{ animationDelay: '50ms', animationFillMode: 'backwards' }}
            >
              {t('heroEyebrow')}
            </p>

            <h1
              className="animate-fade-in mt-3 text-balance font-display text-4xl font-semibold leading-[1.07] tracking-tight text-foreground sm:text-5xl lg:text-6xl"
              style={{ animationDelay: '110ms', animationFillMode: 'backwards' }}
            >
              {t('heroTitle')}
            </h1>

            <p
              className="animate-fade-in mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
              style={{ animationDelay: '180ms', animationFillMode: 'backwards' }}
            >
              {t('heroSubtitle')}
            </p>

            {/* Prominent email capture */}
            <div
              className="animate-fade-in mt-10 w-full"
              style={{ animationDelay: '260ms', animationFillMode: 'backwards' }}
            >
              <AcademyNotifyForm />
            </div>
          </div>
        </Container>
      </section>

      {/* ── What you'll learn — track teasers ── */}
      <section className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
            <p className="section-label">{t('tracksEyebrow')}</p>
            <h2 className="mt-3 text-balance font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('tracksTitle')}
            </h2>
            <p className="mt-4 text-balance text-base leading-relaxed text-muted-foreground">
              {t('tracksSubtitle')}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {tracks.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600 transition-colors duration-300 group-hover:bg-primary-100">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary-600/70">
                  {t('comingSoon')}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Course poster teaser grid (placeholder drop zone) ── */}
      <section className="border-y border-border/60 bg-muted/25 py-20 sm:py-28">
        <Container size="xl">
          <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
            <p className="section-label">{t('postersEyebrow')}</p>
            <h2 className="mt-3 text-balance font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('postersTitle')}
            </h2>
            <p className="mt-4 text-balance text-base leading-relaxed text-muted-foreground">
              {t('postersSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3">
            {/* Real posters (none yet — see COURSE POSTERS DROP ZONE above) */}
            {coursePosters.map((poster) => (
              <div
                key={poster.src}
                className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border/60 bg-card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={poster.src}
                  alt={poster.alt}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
            ))}

            {/* Branded "coming soon" placeholders */}
            {Array.from({ length: placeholderCount }).map((_, i) => (
              <div
                key={`placeholder-${i}`}
                className="relative flex aspect-[3/4] flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-background/60"
              >
                <div aria-hidden className="absolute inset-0 -z-10 bg-dot-grid opacity-60" />
                <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-400">
                  <GraduationCap className="size-6" />
                </div>
                <span className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t('comingSoon')}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Why the academy ── */}
      <section className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
            <p className="section-label">{t('whyEyebrow')}</p>
            <h2 className="mt-3 text-balance font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('whyTitle')}
            </h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {pillars.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card p-6">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Final CTA — repeat the capture on a dark band ── */}
      <section className="pb-20 sm:pb-28">
        <Container size="lg">
          <div className="relative overflow-hidden rounded-2xl bg-foreground px-5 py-14 text-center sm:rounded-3xl sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(142_65%_30%_/_0.35),_transparent_60%)]"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-balance font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                {t('ctaTitle')}
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-balance text-base text-white/60">
                {t('ctaSubtitle')}
              </p>
              <div className="mt-10">
                <AcademyNotifyForm variant="dark" />
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
