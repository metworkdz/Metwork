import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ExternalLink, MapPin } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { MemberBadge } from '@/components/shared/member-badge';
import { memberBadgeFor } from '@/lib/member-badge';
import { publicVentureBySlug } from '@/server/ventures/service';
import { getCityName } from '@/config/cities';
import { assertLandingVisible } from '@/lib/landing-visibility';
import { getServerSession } from '@/lib/session';
import { ContactButton } from '@/components/features/messaging/contact-button';
import type { Locale } from '@/i18n/config';

// Live: the page disappears the moment the owner's Founder plan lapses.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  await assertLandingVisible('startups');
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const found = await publicVentureBySlug(slug);
  if (!found) return {};
  return { title: found.venture.name, description: found.venture.description.slice(0, 160) };
}

/** Public venture page — a Founder benefit, shown only while it applies. */
export default async function PublicVenturePage({ params }: PageProps) {
  await assertLandingVisible('startups');
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const found = await publicVentureBySlug(slug);
  if (!found) notFound();
  const { venture, owner } = found;
  const t = await getTranslations('venture');
  const viewer = await getServerSession().catch(() => null);

  return (
    <Container size="md" className="py-10 sm:py-16">
      <article className="space-y-6">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
            {t(`kind.${venture.kind}`)} · {t(`stages.${venture.stage}`)}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{venture.name}</h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{venture.sector}</span>
            {venture.wilaya && (
              <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{getCityName(venture.wilaya, locale as Locale)}</span>
            )}
            {venture.legal.hasStartupLabel && <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{t('labelBadge')}</span>}
          </p>
        </header>
        {venture.description && <p className="whitespace-pre-line leading-relaxed">{venture.description}</p>}
        {venture.lookingFor.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold">{t('publicLookingFor')}</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {venture.lookingFor.map((n) => (
                <li key={n} className="rounded-full border px-3 py-1 text-sm">{t(`needs.${n}`)}</li>
              ))}
            </ul>
          </section>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <p className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('publicFounder')}</span>
            <span className="font-medium">{owner.fullName}</span>
            <MemberBadge badge={memberBadgeFor(owner)} />
          </p>
          {viewer?.id !== owner.id && (
            <ContactButton
              toId={owner.id}
              toName={owner.fullName.split(' ')[0] ?? owner.fullName}
              contextType="VENTURE"
              contextId={venture.id}
              viewerRole={viewer?.role ?? null}
              returnPath={`/ventures/${venture.slug}`}
            />
          )}
          {venture.website && (
            <a href={venture.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ExternalLink className="size-4" /> {t('publicWebsite')}
            </a>
          )}
        </footer>
      </article>
    </Container>
  );
}
