import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LockedNotice } from '@/components/features/startups/locked-notice';
import { findStartupById } from '@/server/startups/service';
import { toPublicStartupDto } from '@/server/startups/serialize';
import { db } from '@/server/db/store';
import { assertLandingVisible } from '@/lib/landing-visibility';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('investors');
  const { id, locale } = await params;
  setRequestLocale(locale);
  const record = await findStartupById(id);
  if (!record) return { title: 'Startup not found' };
  // Use the redacted tagline, not the full description — <meta> tags are
  // visible in page source to anyone, authenticated or not.
  return {
    title: record.name,
    description: toPublicStartupDto(record).tagline,
  };
}

export default async function StartupDetailPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('investors');
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [record, t, tStage] = await Promise.all([
    findStartupById(id),
    getTranslations('pages.investorStartup'),
    getTranslations('startup.profileForm'),
  ]);

  if (!record || record.status !== 'ACTIVE') notFound();

  // Resolve founder's city only — never the founder's identity/contact.
  const { users } = await db.read();
  const founder = users.find((u) => u.id === record.founderId);
  const startup = toPublicStartupDto(record, { city: founder?.city ?? null });

  return (
    <Container size="md" className="py-10 sm:py-14">
      {/* Back */}
      <Link
        href="/investors"
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t('backToMarketplace')}
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="default">{startup.industry}</Badge>
          {startup.maturityStage && (
            <Badge variant="outline">{tStage(`stage${startup.maturityStage}`)}</Badge>
          )}
          {startup.isRaising && <Badge variant="success">{t('raisingBadge')}</Badge>}
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {startup.name}
        </h1>
        {startup.city && <p className="text-sm text-muted-foreground">{startup.city}</p>}
        <p className="text-base leading-relaxed text-muted-foreground">{startup.tagline}</p>
      </div>

      {/* Locked: funding ask, equity, valuation, pitch deck, website, founder contact */}
      <LockedNotice
        label={t('lockedLabel')}
        cta={t('lockedCta')}
        className="mt-8"
      />

      {/* CTA */}
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/signup">{t('ctaConnect')}</Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/investors">{t('ctaBrowse')}</Link>
        </Button>
      </div>
    </Container>
  );
}
