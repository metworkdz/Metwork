import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Container } from '@/components/ui/container';
import { siteConfig } from '@/config/site';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata: Metadata = {
  title: 'Terms of service — Metwork',
  description:
    'Read the Terms of Service governing your use of the Metwork platform, operated by EURL METWORK.',
};

const EFFECTIVE_DATE = '2024-01-01';
const LAST_UPDATED = '2026-07-31';

const TOC_IDS = [
  'acceptance', 'services', 'accounts', 'conduct', 'payments', 'international-payments',
  'ip', 'disclaimer', 'liability', 'termination', 'changes', 'governing', 'contact',
] as const;

const PLATFORM = siteConfig.entities.platform;
const PAYMENTS = siteConfig.entities.internationalPayments;

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.terms');

  /**
   * Entity values shared by several clauses. Company name, registration number
   * and postal address are legal identifiers and are never translated; the
   * country name appears as prose ("registered in the United Kingdom"), so it
   * comes from the message catalogue instead.
   */
  const entityVars = {
    platformName: PLATFORM.name,
    paymentsName: PAYMENTS.name,
    paymentsCountry: t('paymentsCountryName'),
    paymentsReg: PAYMENTS.registrationNumber,
    paymentsAddress: PAYMENTS.address,
    email: siteConfig.contact.email,
  };

  const tocLabels: Record<(typeof TOC_IDS)[number], string> = {
    acceptance:              t('toc1'),
    services:                t('toc2'),
    accounts:                t('toc3'),
    conduct:                 t('toc4'),
    payments:                t('toc5'),
    'international-payments': t('toc6'),
    ip:                      t('toc7'),
    disclaimer:              t('toc8'),
    liability:               t('toc9'),
    termination:             t('toc10'),
    changes:                 t('toc11'),
    governing:               t('toc12'),
    contact:                 t('toc13'),
  };

  /**
   * Rich-tag renderers + the values they wrap. The anchor markup lives in the
   * message (word order differs per language); the address and URL are fed from
   * siteConfig so they stay defined in one place.
   */
  const linkTags = {
    email: siteConfig.contact.email,
    url: siteConfig.url,
    emailLink: (chunks: React.ReactNode) => (
      <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">
        {chunks}
      </a>
    ),
    urlLink: (chunks: React.ReactNode) => (
      <a href={siteConfig.url} className="text-primary hover:underline">
        {chunks}
      </a>
    ),
    privacyLink: (chunks: React.ReactNode) => (
      <a href="../privacy-policy" className="text-primary hover:underline">
        {chunks}
      </a>
    ),
  };

  return (
    <>
      {/* Hero */}
      <section className="border-b border-border/60 bg-muted/20 py-14 sm:py-20">
        <Container size="md">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-primary">
              {t('heroEyebrow')}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t('heroMeta', { effectiveDate: EFFECTIVE_DATE, lastUpdated: LAST_UPDATED })}
            </p>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              {t('heroIntro')}
            </p>
          </div>
        </Container>
      </section>

      {/* Body */}
      <section className="py-14 sm:py-20">
        <Container size="md">
          <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-14">

            {/* Sticky sidebar TOC */}
            <aside className="hidden lg:block">
              <div className="sticky top-20">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('tocHeading')}
                </p>
                <nav className="space-y-1">
                  {TOC_IDS.map((id) => (
                    <a
                      key={id}
                      href={`#${id}`}
                      className="block rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {tocLabels[id]}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Main content */}
            <article className="space-y-12 text-sm leading-relaxed text-foreground">

              {/* 1 */}
              <Section id="acceptance" title={t('sec1Title')}>
                <p>{t.rich('s1p1', linkTags)}</p>
                <p>{t.rich('s1p2', linkTags)}</p>
                <p>{t('s1p3')}</p>
              </Section>

              {/* 2 */}
              <Section id="services" title={t('sec2Title')}>
                <p>{t('s2p1')}</p>
                <ul>
                  <li><strong>{t('s2li1Strong')}</strong> {t('s2li1')}</li>
                  <li><strong>{t('s2li2Strong')}</strong> {t('s2li2')}</li>
                  <li><strong>{t('s2li3Strong')}</strong> {t('s2li3')}</li>
                </ul>
                <p>{t('s2p2')}</p>
              </Section>

              {/* 3 */}
              <Section id="accounts" title={t('sec3Title')}>
                <p>{t('s3p1')}</p>
                <ul>
                  <li>{t('s3li1')}</li>
                  <li>{t('s3li2')}</li>
                  <li>{t('s3li3')}</li>
                  <li>{t.rich('s3li4', linkTags)}</li>
                  <li>{t('s3li5')}</li>
                </ul>
                <p>{t('s3p2')}</p>
              </Section>

              {/* 4 */}
              <Section id="conduct" title={t('sec4Title')}>
                <p>{t('s4p1')}</p>
                <ul>
                  {(['s4li1', 's4li2', 's4li3', 's4li4', 's4li5', 's4li6', 's4li7', 's4li8'] as const).map((k) => (
                    <li key={k}>{t(k)}</li>
                  ))}
                </ul>
                <p>{t('s4p2')}</p>
              </Section>

              {/* 5 */}
              <Section id="payments" title={t('sec5Title')}>
                <p>{t('s5p1')}</p>
                <SubSection title={t('sec5sub1')}>
                  <p>{t('s5s1p1')}</p>
                </SubSection>
                <SubSection title={t('sec5sub2')}>
                  <p>{t('s5s2p1')}</p>
                </SubSection>
                <SubSection title={t('sec5sub3')}>
                  <p>{t.rich('s5s3p1', linkTags)}</p>
                </SubSection>
              </Section>

              {/* 6 — international card payments (Transferly) */}
              <Section id="international-payments" title={t('sec6Title')}>
                <p>{t('s6p1', entityVars)}</p>
                <p>{t('s6p2', entityVars)}</p>
                <p>{t.rich('s6p3', { ...entityVars, ...linkTags })}</p>
                <p>{t('s6p4', entityVars)}</p>
              </Section>

              {/* 7 */}
              <Section id="ip" title={t('sec7Title')}>
                <p>{t('s7p1')}</p>
                <p>{t('s7p2')}</p>
                <p>{t('s7p3')}</p>
              </Section>

              {/* 8 */}
              <Section id="disclaimer" title={t('sec8Title')}>
                <p>{t('s8p1')}</p>
                <p>{t('s8p2')}</p>
                <p>{t('s8p3')}</p>
              </Section>

              {/* 9 */}
              <Section id="liability" title={t('sec9Title')}>
                <p>{t('s9p1')}</p>
                <p>{t('s9p2')}</p>
              </Section>

              {/* 10 */}
              <Section id="termination" title={t('sec10Title')}>
                <p>{t.rich('s10p1', linkTags)}</p>
                <p>{t('s10p2')}</p>
              </Section>

              {/* 11 */}
              <Section id="changes" title={t('sec11Title')}>
                <p>{t('s11p1')}</p>
                <p>{t('s11p2')}</p>
              </Section>

              {/* 12 */}
              <Section id="governing" title={t('sec12Title')}>
                <p>{t('s12p1')}</p>
                <p>{t.rich('s12p2', linkTags)}</p>
              </Section>

              {/* 13 — both contracting entities, labelled by role */}
              <Section id="contact" title={t('sec13Title')}>
                <p>{t('s13p1')}</p>

                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('s13PlatformRole')}
                  </p>
                  <p className="font-semibold">{PLATFORM.name}</p>
                  {/* dir="ltr" on the identifier itself: in an RTL page the bidi
                      algorithm otherwise reorders a Latin/numeric registration
                      number or street address into the wrong visual order. */}
                  <p className="text-muted-foreground text-xs">
                    {t('s13PlatformRegistration')}{' '}
                    <span dir="ltr" className="inline-block">{PLATFORM.registrationNumber}</span>
                  </p>
                  <p dir="ltr" className="rtl:text-end">{PLATFORM.address}</p>
                  <p>
                    {t('s13Email')}{' '}
                    <a href={`mailto:${PLATFORM.email}`} className="text-primary hover:underline">
                      {PLATFORM.email}
                    </a>
                  </p>
                  <p>
                    {t('s13Phone')}{' '}
                    <a href={`tel:${PLATFORM.phone}`} className="text-primary hover:underline" dir="ltr">
                      {PLATFORM.phone}
                    </a>
                  </p>
                </address>

                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('s13PaymentsRole')}
                  </p>
                  <p className="font-semibold">{PAYMENTS.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {t('s13PaymentsRegistration')}{' '}
                    <span dir="ltr" className="inline-block">{PAYMENTS.registrationNumber}</span>
                  </p>
                  <p dir="ltr" className="rtl:text-end">{PAYMENTS.address}</p>
                  <p dir="ltr" className="rtl:text-end">{PAYMENTS.country}</p>
                  <p>
                    {t('s13Email')}{' '}
                    <a href={`mailto:${PAYMENTS.email}`} className="text-primary hover:underline">
                      {PAYMENTS.email}
                    </a>
                  </p>
                </address>
              </Section>

            </article>
          </div>
        </Container>
      </section>
    </>
  );
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <h2 className="border-b border-border/60 pb-2 text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}
