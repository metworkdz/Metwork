import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  GraduationCap,
  Megaphone,
  Rocket,
  ShieldCheck,
  TrendingUp,
  Users,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/config/site';

/** Refresh live course highlights hourly without blocking requests. */
export const revalidate = 3600;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.academy');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

interface AcademyCourse {
  key: string;
  title: string;
  link: string;
  excerpt: string;
  image: string | null;
}

/** Strip HTML tags and decode the common entities WordPress returns. */
function cleanHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:#039|apos|rsquo|lsquo);/g, "'")
    .replace(/&(?:ldquo|rdquo);/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort fetch of live course highlights from the LearnDash WordPress
 * REST API. Never throws and never blocks render — any failure (network,
 * timeout, unexpected shape) yields an empty list so the page falls back to
 * curated static content.
 */
async function getAcademyCourses(): Promise<AcademyCourse[]> {
  try {
    const res = await fetch(`${siteConfig.academy.apiUrl}?per_page=6&_embed`, {
      next: { revalidate },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];

    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];

    const courses: AcademyCourse[] = [];
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue;
      const c = raw as Record<string, unknown>;

      const title = cleanHtml(String((c.title as { rendered?: unknown })?.rendered ?? ''));
      const link = typeof c.link === 'string' ? c.link : '';
      if (!title || !link) continue;

      const rawExcerpt = cleanHtml(String((c.excerpt as { rendered?: unknown })?.rendered ?? ''));
      const excerpt =
        rawExcerpt.length > 150 ? `${rawExcerpt.slice(0, 147).trimEnd()}…` : rawExcerpt;

      const media = (c._embedded as { 'wp:featuredmedia'?: unknown })?.['wp:featuredmedia'];
      const first = Array.isArray(media) ? media[0] : undefined;
      const source = (first as { source_url?: unknown } | undefined)?.source_url;
      const image = typeof source === 'string' ? source : null;

      courses.push({ key: link, title, link, excerpt, image });
      if (courses.length >= 6) break;
    }
    return courses;
  } catch {
    return [];
  }
}

const FALLBACK_ICONS = [Rocket, TrendingUp, ShieldCheck, Megaphone] as const;
const PILLAR_ICONS = [Users, BookOpen, Sparkles] as const;

export default async function AcademyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.academy');

  const courses = await getAcademyCourses();
  const hasLive = courses.length > 0;

  const fallbackCourses = FALLBACK_ICONS.map((icon, i) => ({
    icon,
    title: t(`fallback${i + 1}Title`),
    description: t(`fallback${i + 1}Desc`),
  }));

  const pillars = PILLAR_ICONS.map((icon, i) => ({
    icon,
    title: t(`pillar${i + 1}Title`),
    description: t(`pillar${i + 1}Desc`),
  }));

  return (
    <div className="bg-background">
      {/* ── Hero ── */}
      <section className="border-b border-border/60 bg-gradient-to-b from-primary-50/60 to-background">
        <Container size="xl" className="py-20 sm:py-28 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5">
              <GraduationCap className="size-3.5 text-primary-600" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary-700">
                {t('heroEyebrow')}
              </span>
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {t('heroTitle')}{' '}
              <span className="text-primary-600">{t('heroTitleHighlight')}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t('heroSubtitle')}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <a href={siteConfig.academy.registerUrl} target="_blank" rel="noopener noreferrer">
                  {t('startLearning')}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <a href={siteConfig.academy.coursesUrl} target="_blank" rel="noopener noreferrer">
                  {t('exploreCourses')}
                </a>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Courses ── */}
      <section className="py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('coursesEyebrow')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('coursesTitle')}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t('coursesSubtitle')}
            </p>
          </div>

          {hasLive ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <a
                  key={course.key}
                  href={course.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md"
                >
                  <div className="aspect-[16/9] overflow-hidden bg-muted">
                    {course.image ? (
                      <img
                        src={course.image}
                        alt={course.title}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-primary-50">
                        <GraduationCap className="size-10 text-primary-300" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="text-base font-semibold text-foreground group-hover:text-primary-700">
                      {course.title}
                    </h3>
                    {course.excerpt && (
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                        {course.excerpt}
                      </p>
                    )}
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600">
                      {t('viewCourse')}
                      <ArrowRight className="size-4 rtl:rotate-180" />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {fallbackCourses.map(({ icon: Icon, title, description }) => (
                <a
                  key={title}
                  href={siteConfig.academy.coursesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col rounded-xl border border-border/60 bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md"
                >
                  <div className="flex size-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600">
                    {t('viewCourse')}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </span>
                </a>
              ))}
            </div>
          )}
        </Container>
      </section>

      {/* ── Why the academy ── */}
      <section className="border-y border-border/60 bg-muted/25 py-20 sm:py-28">
        <Container size="xl">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              {t('whyEyebrow')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('whyTitle')}
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {pillars.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card p-6">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 sm:py-28">
        <Container size="md" className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t('ctaTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t('ctaSubtitle')}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={siteConfig.academy.registerUrl} target="_blank" rel="noopener noreferrer">
                {t('startLearning')}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <a href={siteConfig.academy.coursesUrl} target="_blank" rel="noopener noreferrer">
                {t('exploreCourses')}
              </a>
            </Button>
          </div>
        </Container>
      </section>
    </div>
  );
}
