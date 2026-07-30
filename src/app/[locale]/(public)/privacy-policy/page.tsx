import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Container } from '@/components/ui/container';
import { siteConfig } from '@/config/site';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('footer');
  return {
    title: `${t('privacy')} — ${siteConfig.name}`,
    description: 'How Metwork collects, uses, and protects your personal data in compliance with Algerian Law 18-07.',
  };
}

const EFFECTIVE_DATE = '2024-01-01';
const LAST_UPDATED = '2026-07-31';

const DPO_EMAIL = 'dpo@metwork.dz';

const PLATFORM = siteConfig.entities.platform;
const PAYMENTS = siteConfig.entities.internationalPayments;

/** Section anchors, in document order. Labels come from `toc1…toc13`. */
const TOC_IDS = [
  'introduction', 'controller', 'data-collected', 'how-we-use', 'legal-basis',
  'retention', 'sharing', 'cookies', 'your-rights', 'security', 'children',
  'changes', 'contact',
] as const;

export default async function PrivacyPolicyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.privacy');

  /**
   * Rich-tag renderers and the values they wrap. The anchor markup lives in the
   * message because word order around a link differs per language; the
   * addresses come from siteConfig so they stay defined in one place.
   */
  const linkTags = {
    url: siteConfig.url,
    email: siteConfig.contact.email,
    dpoEmail: DPO_EMAIL,
    urlLink: (chunks: React.ReactNode) => (
      <a href={siteConfig.url} className="text-primary hover:underline">{chunks}</a>
    ),
    emailLink: (chunks: React.ReactNode) => (
      <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">{chunks}</a>
    ),
    dpoLink: (chunks: React.ReactNode) => (
      <a href={`mailto:${DPO_EMAIL}`} className="text-primary hover:underline">{chunks}</a>
    ),
  };

  /**
   * Entity names interpolated into the payment clauses. The company name is a
   * legal identifier and is never translated; the country appears as prose, so
   * it comes from the message catalogue.
   */
  const entityVars = {
    platformName: PLATFORM.name,
    paymentsName: PAYMENTS.name,
    paymentsCountry: t('paymentsCountryName'),
  };

  const purposeRows = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((n) => ({
    purpose: t(`s4r${n}p`),
    basis: t(`s4r${n}b`),
  }));

  const rights = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({
    title: t(`s9r${n}Title`),
    desc: t(`s9r${n}Desc`),
  }));

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
              {t('heroMeta', { effectiveDate: EFFECTIVE_DATE, lastUpdated: LAST_UPDATED })}{' '}
              <span className="font-medium text-foreground">
                {siteConfig.legal.lawReference}
              </span>
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

            {/* Table of contents — sticky sidebar on large screens */}
            <aside className="hidden lg:block">
              <div className="sticky top-20">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('tocHeading')}
                </p>
                <nav className="space-y-1">
                  {TOC_IDS.map((id, i) => (
                    <a
                      key={id}
                      href={`#${id}`}
                      className="block rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {t(`toc${i + 1}`)}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Main content */}
            <article className="space-y-12 text-sm leading-relaxed text-foreground">

              {/* ── 1. Introduction ── */}
              <Section id="introduction" title={t('s1Title')}>
                <p>{t.rich('s1p1', { ...linkTags, ...entityVars })}</p>
                <p>{t('s1p2')}</p>
                <p>{t('s1p3')}</p>
              </Section>

              {/* ── 2. Data controller ── */}
              <Section id="controller" title={t('s2Title')}>
                <p>{t('s2p1')}</p>

                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('s2PlatformRole')}
                  </p>
                  <p className="font-semibold">{PLATFORM.name}</p>
                  {/* dir="ltr" on the identifier itself: in an RTL page the bidi
                      algorithm otherwise reorders a Latin/numeric registration
                      number or street address into the wrong visual order. */}
                  <p className="text-muted-foreground text-xs">
                    {t('s2Registration')}{' '}
                    <span dir="ltr" className="inline-block">{PLATFORM.registrationNumber}</span>
                  </p>
                  <p dir="ltr" className="rtl:text-end">{PLATFORM.address}</p>
                  <p>
                    {t('s2Email')}{' '}
                    <a href={`mailto:${PLATFORM.email}`} className="text-primary hover:underline">
                      {PLATFORM.email}
                    </a>
                  </p>
                  <p>
                    {t('s2Phone')}{' '}
                    <a href={`tel:${PLATFORM.phone}`} className="text-primary hover:underline" dir="ltr">
                      {PLATFORM.phone}
                    </a>
                  </p>
                </address>

                {/* Independent controller for international card transactions. */}
                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('s2PaymentsRole')}
                  </p>
                  <p className="font-semibold">{PAYMENTS.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {t('s2PaymentsRegistration')}{' '}
                    <span dir="ltr" className="inline-block">{PAYMENTS.registrationNumber}</span>
                  </p>
                  <p dir="ltr" className="rtl:text-end">{PAYMENTS.address}</p>
                  <p dir="ltr" className="rtl:text-end">{PAYMENTS.country}</p>
                </address>

                <p>{t('s2p2', entityVars)}</p>
                <p>{t.rich('s2p3', linkTags)}</p>
              </Section>

              {/* ── 3. Data we collect ── */}
              <Section id="data-collected" title={t('s3Title')}>
                <p>{t('s3p1')}</p>

                <SubSection title={t('s3sub1Title')}>
                  <p>{t('s3sub1p1')}</p>
                  <ul>
                    {([1, 2, 3, 4, 5, 6] as const).map((n) => (
                      <li key={n}>{t(`s3sub1li${n}`)}</li>
                    ))}
                  </ul>
                </SubSection>

                <SubSection title={t('s3sub2Title')}>
                  <p>{t('s3sub2p1')}</p>
                  <ul>
                    {([1, 2, 3, 4, 5] as const).map((n) => (
                      <li key={n}>{t(`s3sub2li${n}`)}</li>
                    ))}
                  </ul>
                </SubSection>

                <SubSection title={t('s3sub3Title')}>
                  <p>{t('s3sub3p1')}</p>
                  <ul>
                    {([1, 2, 3, 4, 5] as const).map((n) => (
                      <li key={n}>{t(`s3sub3li${n}`)}</li>
                    ))}
                  </ul>
                </SubSection>

                <SubSection title={t('s3sub4Title')}>
                  <p>{t('s3sub4p1')}</p>
                </SubSection>
              </Section>

              {/* ── 4. How we use your data ── */}
              <Section id="how-we-use" title={t('s4Title')}>
                <p>{t('s4p1')}</p>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="py-2 pe-4 text-start font-semibold">{t('s4thPurpose')}</th>
                      <th className="py-2 text-start font-semibold">{t('s4thBasis')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {purposeRows.map(({ purpose, basis }) => (
                      <tr key={purpose}>
                        <td className="py-2 pe-4 text-muted-foreground">{purpose}</td>
                        <td className="py-2 font-medium">{basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              {/* ── 5. Legal basis ── */}
              <Section id="legal-basis" title={t('s5Title')}>
                <p>{t('s5p1')}</p>
                <ol>
                  {([1, 2, 3, 4] as const).map((n) => (
                    <li key={n}>
                      <strong>{t(`s5li${n}Strong`)}</strong> {t(`s5li${n}`)}
                    </li>
                  ))}
                </ol>
                <p>{t('s5p2')}</p>
              </Section>

              {/* ── 6. Retention ── */}
              <Section id="retention" title={t('s6Title')}>
                <p>{t('s6p1')}</p>
                <ul>
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <li key={n}>
                      <strong>{t(`s6li${n}Strong`)}</strong> {t(`s6li${n}`)}
                    </li>
                  ))}
                </ul>
                <p>{t('s6p2')}</p>
              </Section>

              {/* ── 7. Sharing ── */}
              <Section id="sharing" title={t('s7Title')}>
                <p>{t('s7p1')}</p>
                <ul>
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <li key={n}>
                      <strong>{t(`s7li${n}Strong`)}</strong> {t(`s7li${n}`, entityVars)}
                    </li>
                  ))}
                </ul>
                <p>{t('s7p2', entityVars)}</p>
              </Section>

              {/* ── 8. Cookies ── */}
              <Section id="cookies" title={t('s8Title')}>
                <p>{t('s8p1')}</p>
                <SubSection title={t('s8subTitle')}>
                  <ul>
                    {([1, 2, 3] as const).map((n) => (
                      <li key={n}>
                        <strong>{t(`s8li${n}Strong`)}</strong> {t(`s8li${n}`)}
                      </li>
                    ))}
                  </ul>
                </SubSection>
                <p>{t('s8p2')}</p>
              </Section>

              {/* ── 9. Your rights ── */}
              <Section id="your-rights" title={t('s9Title')}>
                <p>{t.rich('s9p1', linkTags)}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {rights.map(({ title, desc }) => (
                    <div
                      key={title}
                      className="rounded-lg border border-border/60 bg-muted/20 p-4"
                    >
                      <p className="font-semibold text-foreground">{title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4">
                  <strong>{t('s9p2Strong')}</strong> {t('s9p2')}
                </p>
              </Section>

              {/* ── 10. Security ── */}
              <Section id="security" title={t('s10Title')}>
                <p>{t('s10p1')}</p>
                <ul>
                  {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
                    <li key={n}>{t(`s10li${n}`)}</li>
                  ))}
                </ul>
                <p>{t('s10p2')}</p>
              </Section>

              {/* ── 11. Children ── */}
              <Section id="children" title={t('s11Title')}>
                <p>{t.rich('s11p1', linkTags)}</p>
              </Section>

              {/* ── 12. Changes ── */}
              <Section id="changes" title={t('s12Title')}>
                <p>{t('s12p1')}</p>
                <ul>
                  {([1, 2, 3] as const).map((n) => (
                    <li key={n}>{t(`s12li${n}`)}</li>
                  ))}
                </ul>
                <p>{t('s12p2')}</p>
              </Section>

              {/* ── 13. Contact / DPO ── */}
              <Section id="contact" title={t('s13Title')}>
                <p>{t('s13p1')}</p>
                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="font-semibold">{t('s13DpoName')}</p>
                  <p>
                    {t('s13Email')}{' '}
                    <a href={`mailto:${DPO_EMAIL}`} className="text-primary hover:underline">
                      {DPO_EMAIL}
                    </a>
                  </p>
                  <p dir="ltr" className="rtl:text-end">{PLATFORM.address}</p>
                </address>
                <p>{t('s13p2')}</p>
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
      <h2 className="text-lg font-semibold tracking-tight text-foreground border-b border-border/60 pb-2">
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
