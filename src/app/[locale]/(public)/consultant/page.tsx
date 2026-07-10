import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowRight, BadgeCheck, CalendarCheck, Link2, ShieldCheck, Sparkles, UserPlus, Wallet,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { assertLandingVisible } from '@/lib/landing-visibility';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('consultant');
  return {
    title: 'Consultants — Metwork',
    description:
      'Offer paid consultations on Metwork: create your consultant profile, share your booking link, and get paid — visibility, scheduling, and payments handled.',
  };
}

/**
 * Public landing page for the consultant offering (/{locale}/consultant).
 * Explains the consultation-reservation service in plain language and funnels
 * to the shared portal login at /consultant/login (prefix-free URL — plain
 * anchors, not the localized Link).
 */
export default async function ConsultantLandingPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('consultant');
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('consultantLanding');

  const steps = [
    { icon: UserPlus, title: t('step1Title'), body: t('step1Body') },
    { icon: ShieldCheck, title: t('step2Title'), body: t('step2Body') },
    { icon: Link2, title: t('step3Title'), body: t('step3Body') },
    { icon: CalendarCheck, title: t('step4Title'), body: t('step4Body') },
  ];

  const benefits = [
    { icon: Sparkles, title: t('benefit1Title'), body: t('benefit1Body') },
    { icon: Wallet, title: t('benefit2Title'), body: t('benefit2Body') },
    { icon: BadgeCheck, title: t('benefit3Title'), body: t('benefit3Body') },
  ];

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50 via-background to-background"
        />
        <Container>
          <div className="flex flex-col items-center pb-14 pt-12 text-center sm:pb-24 sm:pt-24">
            <Badge variant="primary" className="gap-1.5">
              <Sparkles className="size-3" />
              {t('heroBadge')}
            </Badge>
            <h1 className="mt-5 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-4 max-w-xl text-balance text-lg text-muted-foreground">
              {t('heroSubtitle')}
            </p>
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
              <a
                href="/consultant/login?signup=1"
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
              >
                {t('ctaCreate')}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </a>
              <a
                href="/consultant/login"
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-border bg-background px-6 text-base font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                {t('ctaSignIn')}
              </a>
            </div>
            {/* Contact Us — internal localized route, so next-intl Link (not a
                raw <a>); reuses the outline CTA style used above on this page. */}
            <Link
              href="/contact"
              className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-background px-6 text-base font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              {t('ctaContact')}
            </Link>
          </div>
        </Container>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-border/60 bg-muted/30 py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight">{t('howTitle')}</h2>
            <p className="mt-3 text-balance text-base text-muted-foreground">{t('howSubtitle')}</p>
          </div>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-border/60 bg-background p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <step.icon className="size-5" />
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {t('stepLabel', { number: i + 1 })}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ── Benefits ── */}
      <section className="py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight">{t('benefitsTitle')}</h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {benefits.map((b) => (
              <div key={b.title} className="rounded-2xl border border-border/60 p-6 text-center">
                <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <b.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-border/60 bg-[#0D0D0D] py-16 text-white sm:py-20">
        <Container>
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight">{t('finalTitle')}</h2>
            <p className="mt-3 text-balance text-base text-white/60">{t('finalSubtitle')}</p>
            <a
              href="/consultant/login?signup=1"
              className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary-600 px-8 text-base font-semibold text-white transition-colors hover:bg-primary-500"
            >
              {t('ctaCreate')}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </a>
          </div>
        </Container>
      </section>
    </>
  );
}
