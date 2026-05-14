/**
 * /events/[slug] — public event detail + registration page.
 *
 * The `slug` segment accepts both SEO slugs AND legacy UUIDs.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  MapPin, Users, Calendar, Globe, Ticket, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { findEventBySlugOrId, listFormFields } from '@/server/registrations/service';
import { getEventAttendance } from '@/server/bookings/service';
import { RegistrationForm } from '@/components/features/registrations/registration-form';
import { readSession } from '@/server/auth/session';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const event = await findEventBySlugOrId(slug);
  if (!event) return { title: 'Event not found' };
  return {
    title: `${event.title} — ${event.incubatorName}`,
    description: event.description,
    openGraph: {
      title: event.title,
      description: event.description,
      images: event.imageUrl ? [event.imageUrl] : [],
    },
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('events.detail');
  const tReg = await getTranslations('registration');

  const event = await findEventBySlugOrId(slug);
  if (!event) notFound();

  const [{ taken: attendeeCount }, formFields] = await Promise.all([
    getEventAttendance(event.id),
    listFormFields('EVENT', event.id),
  ]);

  const spotsLeft = event.capacity - attendeeCount;
  const isFull = spotsLeft <= 0;
  const isPast = new Date(event.eventDate) < new Date();
  const canRegister = !isFull && !isPast;

  // Pre-fill from session
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
        href="/events"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('backLink')}
      </Link>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* ── Left: image + meta ── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Image */}
          <div className="overflow-hidden rounded-2xl border border-border bg-muted aspect-video">
            {event.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.imageUrl}
                alt={event.title}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Ticket className="size-12 text-muted-foreground/30" />
              </div>
            )}
          </div>

          {/* Badges + title */}
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              {event.isOnline ? (
                <Badge variant="primary" className="gap-1">
                  <Globe className="size-3" />{t('badgeOnline')}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <MapPin className="size-3" />{event.city}
                </Badge>
              )}
              {isFull ? (
                <Badge variant="danger">{t('badgeFull')}</Badge>
              ) : isPast ? (
                <Badge variant="outline">{t('badgePast')}</Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Users className="size-3" />
                  {spotsLeft === 1
                    ? t('spotsRemainingOne')
                    : t('spotsRemainingMany', { count: spotsLeft })}
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{event.title}</h1>
            <p className="mt-1 text-muted-foreground">{event.incubatorName}</p>
          </div>

          {/* Description */}
          {event.description && (
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {event.description}
            </p>
          )}

          {/* Date/location strip */}
          <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-border bg-muted/30 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                <Calendar className="inline size-3 mr-1" />{t('dateLabel')}
              </p>
              <p className={`text-sm font-medium ${isPast ? 'text-muted-foreground' : ''}`}>
                {formatDate(event.eventDate, locale as Locale, { dateStyle: 'long', timeStyle: 'short' })}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {event.isOnline ? (
                  <><Globe className="inline size-3 mr-1" />{t('locationLabel')}</>
                ) : (
                  <><MapPin className="inline size-3 mr-1" />{t('locationLabel')}</>
                )}
              </p>
              <p className="text-sm font-medium">
                {event.isOnline ? t('locationOnline') : event.city}
              </p>
            </div>
          </div>
        </div>

        {/* ── Right: pricing + registration ── */}
        <div className="lg:col-span-2">
          <div className="sticky top-20 rounded-2xl border border-border bg-card p-6 space-y-5">
            {/* Price */}
            <div className="text-center pb-4 border-b border-border">
              <p className="text-3xl font-bold tabular-nums">
                {event.price === 0 ? t('free') : formatCurrency(event.price, locale as Locale)}
              </p>
              {event.price > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">{t('perAttendee')}</p>
              )}
            </div>

            {/* Registration form or status */}
            {canRegister ? (
              <div>
                <h2 className="text-base font-semibold mb-4">{tReg('formTitle')}</h2>
                <RegistrationForm
                  entityType="EVENT"
                  entityId={event.id}
                  entityTitle={event.title}
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
                    <Calendar className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">{t('pastText')}</p>
                  </>
                )}
              </div>
            )}

            {/* Share link */}
            {event.slug && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-xs text-muted-foreground mb-1">{tReg('shareLink')}</p>
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  <code className="text-xs text-muted-foreground truncate">
                    /events/{event.slug}
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
