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
const LAST_UPDATED = '2025-05-01';

const TOC_IDS = [
  'acceptance', 'services', 'accounts', 'conduct', 'payments',
  'ip', 'disclaimer', 'liability', 'termination', 'changes', 'governing', 'contact',
] as const;

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.terms');

  const tocLabels: Record<string, string> = {
    acceptance:  t('toc1'),
    services:    t('toc2'),
    accounts:    t('toc3'),
    conduct:     t('toc4'),
    payments:    t('toc5'),
    ip:          t('toc6'),
    disclaimer:  t('toc7'),
    liability:   t('toc8'),
    termination: t('toc9'),
    changes:     t('toc10'),
    governing:   t('toc11'),
    contact:     t('toc12'),
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
                <p>
                  These Terms of Service (&ldquo;Terms&rdquo;) constitute a legally binding
                  agreement between you and EURL METWORK (&ldquo;Metwork&rdquo;,
                  &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), a company
                  registered in Algeria (Commerce register: 31/00-1125194 B24), governing
                  your access to and use of the Metwork platform accessible at{' '}
                  <a href={siteConfig.url} className="text-primary hover:underline">
                    {siteConfig.url}
                  </a>{' '}
                  and any associated applications (collectively, the &ldquo;Platform&rdquo;).
                </p>
                <p>
                  By registering an account, clicking &ldquo;I agree&rdquo;, or otherwise
                  accessing or using the Platform, you confirm that you have read, understood,
                  and agree to be bound by these Terms and our{' '}
                  <a href="../privacy-policy" className="text-primary hover:underline">
                    Privacy Policy
                  </a>
                  . If you do not agree, you must not use the Platform.
                </p>
                <p>
                  You must be at least 18 years old to use the Platform. By accepting these
                  Terms you represent that you meet this age requirement and have the legal
                  capacity to enter into binding contracts under Algerian law.
                </p>
              </Section>

              {/* 2 */}
              <Section id="services" title={t('sec2Title')}>
                <p>
                  Metwork is an online platform that connects stakeholders in the Algerian
                  startup ecosystem. The Platform provides, among other things:
                </p>
                <ul>
                  <li>
                    <strong>For entrepreneurs:</strong> Discovery and application to incubation
                    and acceleration programs, booking of coworking spaces and private offices,
                    access to a mentor network, connection to investors, and a digital wallet
                    for platform transactions.
                  </li>
                  <li>
                    <strong>For investors:</strong> Discovery of startup listings, direct
                    contact with founders, and deal-flow management tools.
                  </li>
                  <li>
                    <strong>For incubators:</strong> Program and space management, member
                    tracking, and booking administration tools.
                  </li>
                </ul>
                <p>
                  We reserve the right to modify, suspend, or discontinue any part of the
                  Platform at any time, with or without notice, and without liability to you.
                </p>
              </Section>

              {/* 3 */}
              <Section id="accounts" title={t('sec3Title')}>
                <p>
                  To access most features of the Platform, you must create an account. You
                  agree to:
                </p>
                <ul>
                  <li>Provide accurate, current, and complete information during registration</li>
                  <li>Maintain and promptly update your account information</li>
                  <li>Keep your password confidential and not share it with third parties</li>
                  <li>
                    Notify us immediately at{' '}
                    <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">
                      {siteConfig.contact.email}
                    </a>{' '}
                    if you suspect unauthorised access to your account
                  </li>
                  <li>Not create more than one account per person or entity</li>
                </ul>
                <p>
                  You are responsible for all activity that occurs under your account. Metwork
                  cannot and will not be liable for any loss resulting from unauthorised use
                  of your account.
                </p>
              </Section>

              {/* 4 */}
              <Section id="conduct" title={t('sec4Title')}>
                <p>
                  By using the Platform you agree not to:
                </p>
                <ul>
                  <li>Violate any applicable Algerian or international law or regulation</li>
                  <li>
                    Post or transmit content that is false, misleading, defamatory, obscene,
                    or infringes any third-party rights
                  </li>
                  <li>
                    Impersonate any person or entity, or misrepresent your affiliation with any
                    person or entity
                  </li>
                  <li>
                    Use the Platform to send spam, unsolicited messages, or promotional
                    communications not authorised by Metwork
                  </li>
                  <li>
                    Attempt to gain unauthorised access to any portion of the Platform or
                    its related systems
                  </li>
                  <li>Interfere with or disrupt the integrity or performance of the Platform</li>
                  <li>
                    Use automated means (bots, scrapers, crawlers) to access the Platform
                    without our prior written consent
                  </li>
                  <li>
                    Engage in any fraudulent, deceptive, or misleading activity in connection
                    with the Platform
                  </li>
                </ul>
                <p>
                  Metwork reserves the right to remove any content and suspend or terminate
                  any account that violates these rules, at our sole discretion.
                </p>
              </Section>

              {/* 5 */}
              <Section id="payments" title={t('sec5Title')}>
                <p>
                  Certain features of the Platform require payment, including membership
                  subscriptions, coworking space bookings, and program applications. All
                  prices are displayed in Algerian Dinars (DZD) and are inclusive of
                  applicable taxes unless stated otherwise.
                </p>
                <SubSection title={t('sec5sub1')}>
                  <p>
                    The Platform provides a digital wallet that you can top up using supported
                    payment methods. Wallet balances are non-transferable, non-refundable
                    (except in cases of platform error), and may not be exchanged for cash.
                  </p>
                </SubSection>
                <SubSection title={t('sec5sub2')}>
                  <p>
                    Booking cancellations and refund eligibility are governed by the
                    cancellation policy of the relevant incubator or space provider. Metwork
                    facilitates but does not guarantee refunds from third-party providers.
                    Membership fees are non-refundable once a billing period has begun.
                  </p>
                </SubSection>
                <SubSection title={t('sec5sub3')}>
                  <p>
                    If you dispute a charge, please contact us first at{' '}
                    <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">
                      {siteConfig.contact.email}
                    </a>
                    . We will investigate and respond within 10 business days.
                  </p>
                </SubSection>
              </Section>

              {/* 6 */}
              <Section id="ip" title={t('sec6Title')}>
                <p>
                  The Platform and all of its content — including but not limited to text,
                  graphics, logos, icons, images, audio clips, and software — are the property
                  of EURL METWORK or its licensors and are protected by Algerian and
                  international intellectual property laws.
                </p>
                <p>
                  You are granted a limited, non-exclusive, non-transferable, revocable licence
                  to access and use the Platform for its intended purposes. You may not copy,
                  reproduce, distribute, modify, or create derivative works from any part of
                  the Platform without our prior written consent.
                </p>
                <p>
                  Any content you submit to the Platform (startup profiles, messages, etc.)
                  remains your property, but you grant Metwork a worldwide, royalty-free licence
                  to use, store, and display that content in connection with operating the
                  Platform.
                </p>
              </Section>

              {/* 7 */}
              <Section id="disclaimer" title={t('sec7Title')}>
                <p>
                  The Platform is provided on an &ldquo;as is&rdquo; and &ldquo;as
                  available&rdquo; basis, without warranties of any kind, express or implied,
                  including but not limited to warranties of merchantability, fitness for a
                  particular purpose, or non-infringement.
                </p>
                <p>
                  Metwork does not warrant that the Platform will be uninterrupted, error-free,
                  or free of viruses or other harmful components. We do not endorse or guarantee
                  the accuracy, completeness, or reliability of any content posted by users.
                </p>
                <p>
                  Investment decisions made based on information found on the Platform are made
                  at your own risk. Metwork is not a financial advisor and nothing on the
                  Platform constitutes financial or investment advice.
                </p>
              </Section>

              {/* 8 */}
              <Section id="liability" title={t('sec8Title')}>
                <p>
                  To the fullest extent permitted by Algerian law, EURL METWORK and its
                  directors, employees, agents, and licensors shall not be liable for any
                  indirect, incidental, special, consequential, or punitive damages arising
                  out of or in connection with your use of or inability to use the Platform,
                  even if advised of the possibility of such damages.
                </p>
                <p>
                  In no event shall our total aggregate liability to you exceed the greater of
                  (a) the amount you paid to Metwork in the 12 months preceding the claim, or
                  (b) 5,000 DZD.
                </p>
              </Section>

              {/* 9 */}
              <Section id="termination" title={t('sec9Title')}>
                <p>
                  You may close your account at any time from your account settings. Upon
                  closure, your access to the Platform will be revoked and your personal data
                  handled in accordance with our{' '}
                  <a href="../privacy-policy" className="text-primary hover:underline">
                    Privacy Policy
                  </a>
                  .
                </p>
                <p>
                  Metwork may suspend or permanently terminate your account, without prior
                  notice or liability, if you breach these Terms, if we reasonably believe
                  your use poses a security risk, or if required by law. Provisions of these
                  Terms that by their nature should survive termination (including intellectual
                  property, limitation of liability, and governing law) shall survive.
                </p>
              </Section>

              {/* 10 */}
              <Section id="changes" title={t('sec10Title')}>
                <p>
                  We reserve the right to update these Terms at any time. When we make
                  material changes, we will update the &ldquo;Last updated&rdquo; date at
                  the top of this page and notify registered users by email at least 14 days
                  before the changes take effect.
                </p>
                <p>
                  Your continued use of the Platform after the effective date of the revised
                  Terms constitutes your acceptance of the changes. If you do not agree to the
                  new Terms, you must stop using the Platform and close your account.
                </p>
              </Section>

              {/* 11 */}
              <Section id="governing" title={t('sec11Title')}>
                <p>
                  These Terms are governed by and construed in accordance with the laws of
                  the People&apos;s Democratic Republic of Algeria. Any dispute arising out
                  of or in connection with these Terms or your use of the Platform shall be
                  subject to the exclusive jurisdiction of the competent courts of Oran,
                  Algeria.
                </p>
                <p>
                  Before initiating any legal proceedings, you agree to first attempt to
                  resolve the dispute informally by contacting us at{' '}
                  <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">
                    {siteConfig.contact.email}
                  </a>
                  . We will endeavour to respond within 15 business days.
                </p>
              </Section>

              {/* 12 */}
              <Section id="contact" title={t('sec12Title')}>
                <p>
                  For any questions or concerns about these Terms, please contact us:
                </p>
                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="font-semibold">EURL METWORK</p>
                  <p className="text-muted-foreground text-xs">Commerce register: 31/00-1125194 B24</p>
                  <p>{siteConfig.contact.address}</p>
                  <p>
                    Email:{' '}
                    <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">
                      {siteConfig.contact.email}
                    </a>
                  </p>
                  <p>
                    Phone:{' '}
                    <a href={`tel:${siteConfig.contact.phone}`} className="text-primary hover:underline">
                      {siteConfig.contact.phone}
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
