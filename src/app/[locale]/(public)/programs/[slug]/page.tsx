/**
 * /programs/[slug] — public program detail + registration page.
 *
 * The `slug` segment accepts both SEO slugs AND legacy UUIDs
 * (backward-compatible lookup in findProgramBySlugOrId).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  MapPin, Users, Calendar, Clock, Briefcase, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { findProgramBySlugOrId } from '@/server/registrations/service';
import { programHostName } from '@/server/programs/ownership';
import { listFormFields } from '@/server/registrations/service';
import { getProgramAttendance } from '@/server/bookings/service';
import { programTypeLabel } from '@/components/features/programs/program-meta';
import { RegistrationForm } from '@/components/features/registrations/registration-form';
import { ImageCarousel } from '@/components/shared/image-carousel';
import { readSession } from '@/server/auth/session';
import type { ProgramType } from '@/types/domain';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { assertLandingVisible } from '@/lib/landing-visibility';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('programs');
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const program = await findProgramBySlugOrId(slug);
  if (!program) return { title: 'Program not found' };
  return {
    title: `${program.title} — ${programHostName(program)}`,
    description: program.description,
    openGraph: {
      title: program.title,
      description: program.description,
      images: program.imageUrl ? [program.imageUrl] : [],
    },
  };
}

export default async function ProgramDetailPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('programs');
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('programs.detail');
  const tReg = await getTranslations('registration');

  const program = await findProgramBySlugOrId(slug);
  if (!program) notFound();

  const galleryImages = program.imageUrls?.length
    ? program.imageUrls
    : (program.imageUrl ? [program.imageUrl] : []);

  const [{ taken: seatsTaken }, formFields] = await Promise.all([
    getProgramAttendance(program.id),
    listFormFields('PROGRAM', program.id),
  ]);

  const seatsLeft = program.seatsTotal - seatsTaken;
  const isFull = seatsLeft <= 0;
  const deadlinePassed = new Date(program.deadline) < new Date();
  const canRegister = !isFull && !deadlinePassed;

  // Pre-fill from session if logged in
  const session = await readSession();
  const prefill = session
    ? {
        fullName: session.user.fullName,
        email: session.user.email,
        phone: session.user.phone,
      }
    : undefined;

  return (
    <Container className="py-10 sm:py-14">
      {/* Back link */}
      <Link
        href="/programs"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('backLink')}
      </Link>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* ── Left: image + meta ── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Image gallery */}
          {galleryImages.length > 0 ? (
            <ImageCarousel images={galleryImages} alt={program.title} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-muted aspect-video">
              <div className="flex size-full items-center justify-center">
                <Briefcase className="size-12 text-muted-foreground/30" />
              </div>
            </div>
          )}

          {/* Badges + title */}
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="primary">{programTypeLabel[program.type as ProgramType]}</Badge>
              <Badge variant="outline" className="gap-1">
                <MapPin className="size-3" />{program.city}
              </Badge>
              {isFull ? (
                <Badge variant="danger">{t('statusFull')}</Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Users className="size-3" />
                  {seatsLeft === 1 ? t('seatsRemainingOne') : t('seatsRemainingMany', { count: seatsLeft })}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{program.title}</h1>
            <p className="mt-1 text-muted-foreground">{programHostName(program)}</p>
          </div>

          {/* Description */}
          {program.description && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {program.description}
            </p>
          )}

          {/* Dates */}
          <div className="grid gap-3 sm:grid-cols-3 rounded-xl border border-border bg-muted/30 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                <Clock className="inline size-3 mr-1" />{t('deadlineLabel')}
              </p>
              <p className={`text-sm font-medium ${deadlinePassed ? 'text-destructive' : ''}`}>
                {formatDate(program.deadline, locale as Locale)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                <Calendar className="inline size-3 mr-1" />{t('startsLabel')}
              </p>
              <p className="text-sm font-medium">{formatDate(program.startDate, locale as Locale)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                <Calendar className="inline size-3 mr-1" />{t('endsLabel')}
              </p>
              <p className="text-sm font-medium">{formatDate(program.endDate, locale as Locale)}</p>
            </div>
          </div>
        </div>

        {/* ── Right: pricing + registration ── */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 rounded-2xl border border-border bg-card p-6 space-y-5">
            {/* Price */}
            <div className="text-center pb-4 border-b border-border">
              <p className="text-3xl font-bold tabular-nums">
                {program.price === 0 ? t('free') : formatCurrency(program.price, locale as Locale)}
              </p>
              {program.price > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">{t('enrollmentFee')}</p>
              )}
            </div>

            {/* Registration form or status message */}
            {canRegister ? (
              <div>
                <h2 className="text-base font-semibold mb-4">{tReg('formTitle')}</h2>
                <RegistrationForm
                  entityType="PROGRAM"
                  entityId={program.id}
                  entityTitle={program.title}
                  formFields={formFields}
                  prefill={prefill}
                />
              </div>
            ) : (
              <div className="text-center py-4">
                {isFull ? (
                  <>
                    <Users className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">{t('fullText')}</p>
                  </>
                ) : (
                  <>
                    <Clock className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">{t('deadlinePassed')}</p>
                  </>
                )}
              </div>
            )}

            {/* Share link */}
            {program.slug && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-xs text-muted-foreground mb-1">{tReg('shareLink')}</p>
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  <code className="text-xs text-muted-foreground truncate">
                    /programs/{program.slug}
                  </code>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}
