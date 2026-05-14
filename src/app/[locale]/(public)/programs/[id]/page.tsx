import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MapPin, Users, Calendar, Clock, Briefcase, ArrowLeft } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { findProgramById } from '@/server/bookings/program-catalog';
import { ProgramPublicApplyCTA } from '@/components/features/programs/program-public-apply-cta';
import { programTypeLabel } from '@/components/features/programs/program-meta';
import type { ProgramType } from '@/types/domain';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const program = await findProgramById(id);
  if (!program) return { title: 'Program not found' };
  return {
    title: `${program.title} — ${program.incubatorName}`,
    description: program.description,
  };
}

export default async function ProgramDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('programs.detail');

  const program = await findProgramById(id);
  if (!program) notFound();

  const seatsLeft = program.seatsTotal - program.seatsTaken;
  const isFull = seatsLeft <= 0;
  const deadlinePassed = new Date(program.deadline) < new Date();

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
        {/* Left: image + meta */}
        <div className="lg:col-span-3 space-y-6">
          {/* Image */}
          <div className="overflow-hidden rounded-2xl border border-border bg-muted aspect-video">
            {program.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={program.imageUrl}
                alt={program.title}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Briefcase className="size-12 text-muted-foreground/30" />
              </div>
            )}
          </div>

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
            <p className="mt-1 text-muted-foreground">{program.incubatorName}</p>
          </div>

          {/* Description */}
          {program.description && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{program.description}</p>
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

        {/* Right: pricing + apply CTA */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 space-y-4 rounded-2xl border border-border bg-card p-6">
            <div className="text-center">
              <p className="text-3xl font-bold tabular-nums">
                {program.price === 0 ? t('free') : formatCurrency(program.price, locale as Locale)}
              </p>
              {program.price > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">{t('enrollmentFee')}</p>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <ProgramPublicApplyCTA program={program} locale={locale} />
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {isFull
                ? t('fullText')
                : deadlinePassed
                ? t('deadlinePassed')
                : seatsLeft === 1
                ? t('seatsRemainingOne')
                : t('seatsRemainingMany', { count: seatsLeft })}
            </p>
          </div>
        </div>
      </div>
    </Container>
  );
}
