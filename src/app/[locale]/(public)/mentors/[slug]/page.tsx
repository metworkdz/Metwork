/**
 * /mentors/[slug] — public, SEO-friendly mentor profile + booking page.
 *
 * The `slug` segment accepts both SEO slugs AND legacy ids
 * (backward-compatible lookup via findMentorBySlugOrId), so mentors created
 * before slugs existed stay reachable.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Linkedin, Clock, Sparkles, MapPin } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MentorProfileBooking } from '@/components/features/mentors/mentor-profile-booking';
import { findPublicMentorBySlugOrId } from '@/server/mentors/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { toMentorDto } from '@/server/mentors/serialize';
import { safeLinkedinUrl } from '@/lib/linkedin';
import { DURATION_OPTIONS, computePrice, resolveMentorPricing } from '@/lib/consultation-pricing';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { assertLandingVisible } from '@/lib/landing-visibility';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('mentors');
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const mentor = await findPublicMentorBySlugOrId(slug);
  if (!mentor) return { title: 'Mentor not found' };

  const description =
    (mentor.bio?.trim().slice(0, 160)) || `${mentor.fullName} — ${mentor.position}`;
  return {
    title: `${mentor.fullName} — ${mentor.position}`,
    description,
    openGraph: {
      title: `${mentor.fullName} — ${mentor.position}`,
      description,
      type: 'profile',
      images: mentor.imageUrl ? [{ url: mentor.imageUrl }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${mentor.fullName} — ${mentor.position}`,
      description,
      images: mentor.imageUrl ? [mentor.imageUrl] : [],
    },
  };
}

export default async function MentorProfilePage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('mentors');
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const record = await findPublicMentorBySlugOrId(slug);
  if (!record) notFound();
  const mentor = toMentorDto(record);

  const t = await getTranslations('mentors.profile');
  const linkedinHref = safeLinkedinUrl(mentor.linkedinUrl);
  // Canonical price resolution — one helper shared with both booking dialogs.
  const { feePerHour, isPriced, freeIntro } = resolveMentorPricing(mentor);

  return (
    <Container className="py-10 sm:py-14">
      {/* Back link */}
      <Link
        href="/mentors"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t('backLink')}
      </Link>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* ── Left: profile ── */}
        <div className="space-y-8 lg:col-span-3">
          {/* Hero */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted sm:size-36">
              {mentor.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mentor.imageUrl}
                  alt={mentor.fullName}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                  {t('noPhoto')}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <Badge variant="primary" className="gap-1.5">
                <Sparkles className="size-3" />
                {t('mentorBadge')}
              </Badge>
              <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                {mentor.fullName}
              </h1>
              <p className="mt-1.5 text-base text-muted-foreground">{mentor.position}</p>
              {mentor.city && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="size-4 shrink-0" />
                  {mentor.city}
                </p>
              )}
              {linkedinHref && (
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <a href={linkedinHref} target="_blank" rel="noopener noreferrer">
                    <Linkedin className="size-4" />
                    {t('linkedinCta')}
                  </a>
                </Button>
              )}
            </div>
          </div>

          {/* About */}
          <section>
            <h2 className="text-lg font-semibold tracking-tight">{t('aboutTitle')}</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-muted-foreground">
              {mentor.bio?.trim() || t('noBio')}
            </p>
          </section>

          {/* Expertise / area */}
          <section>
            <h2 className="text-lg font-semibold tracking-tight">{t('expertiseTitle')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm">
                <Sparkles className="size-3.5 text-primary" />
                {mentor.position}
              </Badge>
            </div>
          </section>

          {/* Session lengths & pricing */}
          <section>
            <h2 className="text-lg font-semibold tracking-tight">{t('durationsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPriced ? t('hourlyRate', { rate: formatCurrency(feePerHour, locale as Locale) }) : t('pricingNotSet')}
            </p>
            {freeIntro && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary">
                <Sparkles className="size-3.5" />
                {t('freeIntroBadge')}
              </p>
            )}
            {isPriced && (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {DURATION_OPTIONS.map((opt) => {
                  const price = computePrice(feePerHour, opt.value);
                  return (
                    <li
                      key={opt.value}
                      className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        {opt.label}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(price, locale as Locale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right: sticky booking card ── */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="border-b border-border pb-4 text-center">
              <p className={`font-bold tabular-nums ${isPriced ? 'text-3xl' : 'text-lg'}`}>
                {isPriced ? formatCurrency(feePerHour, locale as Locale) : t('pricingNotSet')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isPriced ? t('perHour') : freeIntro ? t('freeIntroBadge') : t('pricingNotSetHint')}
              </p>
            </div>

            <div>
              <h2 className="text-base font-semibold">{t('bookHeading')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('bookSubtitle')}</p>
            </div>

            <MentorProfileBooking mentor={mentor} instantBookEnabled={isInstantBookEnabled()} />
          </div>
        </div>
      </div>
    </Container>
  );
}
