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
const LAST_UPDATED = '2025-01-01';

const TOC = [
  { id: 'introduction',       label: '1. Introduction' },
  { id: 'controller',         label: '2. Data controller' },
  { id: 'data-collected',     label: '3. Data we collect' },
  { id: 'how-we-use',         label: '4. How we use your data' },
  { id: 'legal-basis',        label: '5. Legal basis for processing' },
  { id: 'retention',          label: '6. Data retention' },
  { id: 'sharing',            label: '7. Data sharing' },
  { id: 'cookies',            label: '8. Cookies & tracking' },
  { id: 'your-rights',        label: '9. Your rights' },
  { id: 'security',           label: '10. Data security' },
  { id: 'children',           label: '11. Children\'s privacy' },
  { id: 'changes',            label: '12. Changes to this policy' },
  { id: 'contact',            label: '13. Contact & DPO' },
];

export default async function PrivacyPolicyPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      {/* Hero */}
      <section className="border-b border-border/60 bg-muted/20 py-14 sm:py-20">
        <Container size="md">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-primary">
              Legal
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Privacy Policy
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Effective {EFFECTIVE_DATE} · Last updated {LAST_UPDATED} ·{' '}
              <span className="font-medium text-foreground">
                {siteConfig.legal.lawReference}
              </span>
            </p>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Metwork is committed to protecting the privacy of every person who uses our
              platform. This policy explains what data we collect, why we collect it, and
              the rights you have under Algerian Law 18-07 of June 10, 2018, on the
              protection of natural persons in the processing of personal data.
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
                  Contents
                </p>
                <nav className="space-y-1">
                  {TOC.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="block rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Main content */}
            <article className="space-y-12 text-sm leading-relaxed text-foreground">

              {/* ── 1. Introduction ── */}
              <Section id="introduction" title="1. Introduction">
                <p>
                  Metwork SAS (&ldquo;Metwork&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;,
                  &ldquo;our&rdquo;) operates the platform accessible at{' '}
                  <a href={siteConfig.url} className="text-primary hover:underline">
                    {siteConfig.url}
                  </a>{' '}
                  and associated mobile applications (collectively, the
                  &ldquo;Platform&rdquo;).
                </p>
                <p>
                  We are committed to processing your personal data lawfully, fairly, and
                  transparently. This Privacy Policy describes our practices in accordance
                  with Algerian Law 18-07 of June 10, 2018, relating to the protection of
                  natural persons in the processing of personal data (the &ldquo;Law&rdquo;),
                  as well as its implementing decrees.
                </p>
                <p>
                  By creating an account or using our Platform, you acknowledge that you
                  have read and understood this policy. Where processing is based on consent,
                  you may withdraw it at any time without affecting the lawfulness of
                  processing carried out prior to withdrawal.
                </p>
              </Section>

              {/* ── 2. Data controller ── */}
              <Section id="controller" title="2. Data controller">
                <p>
                  The data controller responsible for your personal data is:
                </p>
                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="font-semibold">Metwork SAS</p>
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
                <p>
                  Our Data Protection Officer (DPO) can be reached at{' '}
                  <a href="mailto:dpo@metwork.dz" className="text-primary hover:underline">
                    dpo@metwork.dz
                  </a>
                  .
                </p>
              </Section>

              {/* ── 3. Data we collect ── */}
              <Section id="data-collected" title="3. Data we collect">
                <p>
                  We collect only the personal data that is necessary for the purposes
                  described in this policy (principle of data minimisation). Categories of
                  data we may process include:
                </p>

                <SubSection title="3.1 Account data">
                  <p>When you register on Metwork, we collect:</p>
                  <ul>
                    <li>Full name</li>
                    <li>Email address</li>
                    <li>Phone number (Algerian mobile)</li>
                    <li>City of residence</li>
                    <li>Role (entrepreneur, investor, or incubator)</li>
                    <li>Password (stored as a one-way cryptographic hash — we never store plaintext passwords)</li>
                  </ul>
                </SubSection>

                <SubSection title="3.2 Profile & activity data">
                  <p>As you use the Platform, we may also collect:</p>
                  <ul>
                    <li>Startup profile information (name, description, industry, funding details) if you list a startup</li>
                    <li>Booking records for coworking spaces or programs</li>
                    <li>Event registrations and attendance records</li>
                    <li>Messages sent through the contact form</li>
                    <li>Wallet and payment transaction records</li>
                  </ul>
                </SubSection>

                <SubSection title="3.3 Technical data">
                  <p>We automatically collect certain technical information when you visit the Platform:</p>
                  <ul>
                    <li>IP address and approximate geolocation</li>
                    <li>Browser type, version, and language settings</li>
                    <li>Device type and operating system</li>
                    <li>Pages visited and time spent, referral source</li>
                    <li>Session identifiers and authentication tokens</li>
                  </ul>
                </SubSection>

                <SubSection title="3.4 Data from third parties">
                  <p>
                    If you use a third-party payment provider (SlickPay), we receive a
                    transaction reference and status confirmation, but never your full
                    card or banking details.
                  </p>
                </SubSection>
              </Section>

              {/* ── 4. How we use your data ── */}
              <Section id="how-we-use" title="4. How we use your data">
                <p>We use personal data for the following purposes:</p>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="py-2 pe-4 text-start font-semibold">Purpose</th>
                      <th className="py-2 text-start font-semibold">Legal basis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[
                      ['Creating and managing your account', 'Contract performance'],
                      ['Verifying your phone number via OTP', 'Contract performance / Consent'],
                      ['Facilitating program applications and space bookings', 'Contract performance'],
                      ['Processing wallet top-ups and payments', 'Contract performance'],
                      ['Connecting entrepreneurs with investors', 'Consent'],
                      ['Sending transactional emails and notifications', 'Contract performance'],
                      ['Sending marketing communications (opt-in only)', 'Consent'],
                      ['Detecting and preventing fraud or abuse', 'Legitimate interest'],
                      ['Analysing platform usage to improve our services', 'Legitimate interest'],
                      ['Complying with legal obligations', 'Legal obligation'],
                    ].map(([purpose, basis]) => (
                      <tr key={purpose}>
                        <td className="py-2 pe-4 text-muted-foreground">{purpose}</td>
                        <td className="py-2 font-medium">{basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              {/* ── 5. Legal basis ── */}
              <Section id="legal-basis" title="5. Legal basis for processing">
                <p>
                  Under Article 14 of Law 18-07, the processing of personal data requires
                  one of the following lawful grounds. We rely on:
                </p>
                <ol>
                  <li>
                    <strong>Explicit consent</strong> — You provide consent at account creation via
                    a dedicated checkbox acknowledging this Privacy Policy and data processing. You
                    may withdraw consent at any time by contacting us or deleting your account.
                  </li>
                  <li>
                    <strong>Performance of a contract</strong> — Processing is necessary to deliver
                    the services you requested when signing up (bookings, startup listings, wallet).
                  </li>
                  <li>
                    <strong>Legal obligation</strong> — We may process and retain data to comply
                    with applicable Algerian law (e.g., accounting and tax obligations).
                  </li>
                  <li>
                    <strong>Legitimate interest</strong> — We process technical and analytics data
                    to secure and improve the Platform, provided this does not override your
                    fundamental rights and freedoms.
                  </li>
                </ol>
                <p>
                  We do not use your personal data for automated decision-making or profiling
                  that produces legal or similarly significant effects.
                </p>
              </Section>

              {/* ── 6. Retention ── */}
              <Section id="retention" title="6. Data retention">
                <p>
                  We retain personal data for as long as necessary to fulfil the purposes
                  set out in this policy, and no longer than required by applicable law.
                  Specific retention periods:
                </p>
                <ul>
                  <li>
                    <strong>Account data:</strong> Retained for the duration of your account plus
                    30 days after account deletion (to allow recovery if deletion was accidental),
                    then permanently erased.
                  </li>
                  <li>
                    <strong>Transaction records:</strong> Retained for 10 years as required by
                    Algerian tax and accounting law.
                  </li>
                  <li>
                    <strong>Contact form submissions:</strong> Retained for 2 years from submission
                    date, then deleted.
                  </li>
                  <li>
                    <strong>Technical logs:</strong> Retained for 12 months, then automatically
                    purged or anonymised.
                  </li>
                  <li>
                    <strong>OTP codes:</strong> Expire within 10 minutes and are never stored
                    after verification.
                  </li>
                </ul>
                <p>
                  Data subject to a legal hold (e.g., ongoing dispute or regulatory request)
                  may be retained beyond standard periods until the hold is lifted.
                </p>
              </Section>

              {/* ── 7. Sharing ── */}
              <Section id="sharing" title="7. Data sharing">
                <p>
                  Metwork does not sell your personal data. We share data only in the
                  following circumstances:
                </p>
                <ul>
                  <li>
                    <strong>Service providers (data processors):</strong> We engage trusted
                    third-party vendors who process data on our behalf under strict data
                    processing agreements — including our payment provider (SlickPay),
                    email delivery service, cloud hosting, and analytics provider. These
                    processors may only use your data for the specific service they provide.
                  </li>
                  <li>
                    <strong>Other users of the Platform:</strong> When you create a public
                    startup listing, your startup&apos;s name, description, and industry are
                    visible to authenticated investors. Your personal contact details are
                    never shared without your explicit consent.
                  </li>
                  <li>
                    <strong>Legal requirements:</strong> We may disclose personal data to
                    competent authorities if required by Algerian law, a court order, or to
                    protect the rights, property, or safety of Metwork or our users.
                  </li>
                  <li>
                    <strong>Business transfer:</strong> In the event of a merger, acquisition,
                    or sale of all or part of our business, your personal data may be
                    transferred to the acquiring entity, subject to equivalent privacy
                    protections. You will be notified in advance.
                  </li>
                </ul>
                <p>
                  Any transfer of personal data outside Algeria is carried out only in
                  compliance with the requirements of Law 18-07 (adequate level of
                  protection or appropriate safeguards such as standard contractual clauses).
                </p>
              </Section>

              {/* ── 8. Cookies ── */}
              <Section id="cookies" title="8. Cookies & tracking">
                <p>
                  We use cookies and similar technologies to operate the Platform, remember
                  your preferences, and analyse usage.
                </p>

                <SubSection title="Types of cookies we use">
                  <ul>
                    <li>
                      <strong>Essential cookies:</strong> Strictly necessary for authentication,
                      session management, and security. Cannot be disabled.
                    </li>
                    <li>
                      <strong>Functional cookies:</strong> Remember your preferences (e.g.,
                      language, locale). Disabled = reduced experience.
                    </li>
                    <li>
                      <strong>Analytics cookies:</strong> Help us understand how visitors use
                      the Platform. All data is anonymised before processing. Requires consent.
                    </li>
                  </ul>
                </SubSection>

                <p>
                  You can manage cookie preferences through your browser settings or our
                  cookie preference centre. Withdrawing consent for non-essential cookies
                  will not affect the core functionality of your account.
                </p>
              </Section>

              {/* ── 9. Your rights ── */}
              <Section id="your-rights" title="9. Your rights under Law 18-07">
                <p>
                  Algerian Law 18-07 grants you the following rights with respect to your
                  personal data. To exercise any right, contact us at{' '}
                  <a href="mailto:dpo@metwork.dz" className="text-primary hover:underline">
                    dpo@metwork.dz
                  </a>{' '}
                  or through your account settings. We will respond within 30 days.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      title: 'Right of access',
                      desc: 'Obtain a copy of all personal data we hold about you, and information on how it is processed.',
                    },
                    {
                      title: 'Right to rectification',
                      desc: 'Correct inaccurate or incomplete personal data. You can update most data directly in your account settings.',
                    },
                    {
                      title: 'Right to erasure',
                      desc: 'Request deletion of your personal data where it is no longer necessary for the purpose it was collected, subject to legal retention obligations.',
                    },
                    {
                      title: 'Right to restriction',
                      desc: 'Ask us to restrict processing of your data in certain circumstances (e.g., while accuracy is disputed).',
                    },
                    {
                      title: 'Right to data portability',
                      desc: 'Receive your personal data in a structured, machine-readable format and transmit it to another controller.',
                    },
                    {
                      title: 'Right to object',
                      desc: 'Object at any time to processing based on legitimate interest, including profiling for direct marketing.',
                    },
                    {
                      title: 'Right to withdraw consent',
                      desc: 'Where processing is based on consent, withdraw it at any time without penalty. Withdrawal does not affect prior processing.',
                    },
                    {
                      title: 'Right to lodge a complaint',
                      desc: 'File a complaint with the Algerian National Authority for Personal Data Protection (ANPDP) if you believe your rights have been violated.',
                    },
                  ].map(({ title, desc }) => (
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
                  <strong>Supervisory authority:</strong> You have the right to lodge a
                  complaint with the ANPDP (Autorité Nationale de Protection des Données
                  à caractère Personnel), the Algerian data protection authority, if you
                  believe we have failed to comply with Law 18-07.
                </p>
              </Section>

              {/* ── 10. Security ── */}
              <Section id="security" title="10. Data security">
                <p>
                  We implement appropriate technical and organisational measures to protect
                  personal data against unauthorised access, alteration, disclosure, or
                  destruction. Our measures include:
                </p>
                <ul>
                  <li>Encryption in transit using TLS 1.2+ for all data exchanges</li>
                  <li>Encryption at rest for database storage</li>
                  <li>Passwords hashed using Argon2id (a memory-hard, salted algorithm)</li>
                  <li>Role-based access controls limiting internal data access on a need-to-know basis</li>
                  <li>Regular security assessments and penetration testing</li>
                  <li>Automated anomaly detection and rate limiting</li>
                  <li>Multi-factor authentication for administrative access</li>
                </ul>
                <p>
                  Despite these measures, no system is perfectly secure. In the event of a
                  personal data breach likely to result in high risk to your rights and
                  freedoms, we will notify you and the competent authorities without undue
                  delay, and in any case within 72 hours of becoming aware, as required
                  by Law 18-07.
                </p>
              </Section>

              {/* ── 11. Children ── */}
              <Section id="children" title="11. Children's privacy">
                <p>
                  The Platform is not directed at children under the age of 18. We do not
                  knowingly collect personal data from anyone under 18. If you believe a
                  minor has provided us with personal data, please contact us immediately at{' '}
                  <a href={`mailto:${siteConfig.contact.email}`} className="text-primary hover:underline">
                    {siteConfig.contact.email}
                  </a>{' '}
                  and we will delete the relevant data promptly.
                </p>
              </Section>

              {/* ── 12. Changes ── */}
              <Section id="changes" title="12. Changes to this policy">
                <p>
                  We may update this Privacy Policy from time to time to reflect changes in
                  our practices, legal requirements, or the services we offer. When we make
                  material changes, we will:
                </p>
                <ul>
                  <li>Update the &ldquo;Last updated&rdquo; date at the top of this page</li>
                  <li>Send an email notification to all registered users</li>
                  <li>Display an in-app notice for 30 days after the update</li>
                </ul>
                <p>
                  Your continued use of the Platform after the effective date of a revised
                  policy constitutes your acceptance of the changes. If you do not agree,
                  you may close your account before the changes take effect.
                </p>
              </Section>

              {/* ── 13. Contact / DPO ── */}
              <Section id="contact" title="13. Contact & Data Protection Officer">
                <p>
                  For any questions, concerns, or requests related to this Privacy Policy
                  or the processing of your personal data, please contact our Data
                  Protection Officer:
                </p>
                <address className="not-italic rounded-lg border border-border/60 bg-muted/30 p-4 space-y-1">
                  <p className="font-semibold">Data Protection Officer — Metwork</p>
                  <p>
                    Email:{' '}
                    <a href="mailto:dpo@metwork.dz" className="text-primary hover:underline">
                      dpo@metwork.dz
                    </a>
                  </p>
                  <p>{siteConfig.contact.address}</p>
                </address>
                <p>
                  We will acknowledge your request within 5 business days and provide a
                  substantive response within 30 calendar days. If your request is complex
                  or you have submitted multiple requests, we may extend this period by up
                  to two additional months, in which case we will inform you accordingly.
                </p>
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
