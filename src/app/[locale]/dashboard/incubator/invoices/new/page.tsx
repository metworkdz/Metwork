import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoiceCreateForm } from '@/components/features/incubator/invoice-create-form';
import { db, type InvoiceKind } from '@/server/db/store';
import { peekNextSeq } from '@/server/invoices/engine';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string }>;
}

export const metadata = { title: 'Nouveau document' };

const KINDS: InvoiceKind[] = ['FACTURE', 'PROFORMA', 'DEVIS'];

export default async function NewInvoicePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { kind: kindParam } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);

  const legalComplete = Boolean(
    incubator?.name &&
    (incubator?.commercialRegNumber ?? incubator?.registrationNumber) &&
    incubator?.nif,
  );
  const hasBankRib = Boolean(incubator?.bankRib?.trim());

  // The number the form offers by default, per kind. peekNextSeq is read-only
  // — opening the page must not consume a number.
  const year = new Date().getUTCFullYear();
  const counters = { invoiceCounters: incubator?.invoiceCounters ?? null };
  const nextSeq = Object.fromEntries(
    KINDS.map((k) => [k, peekNextSeq(counters, year, k)]),
  ) as Record<InvoiceKind, number>;
  const initialKind = KINDS.find((k) => k === kindParam) ?? 'FACTURE';

  const services = incubator
    ? (data.services ?? [])
        .filter((s) => s.incubatorId === incubator.id && s.isActive)
        .map((s) => s.name)
    : [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.newInvoice.title')}
        subtitle={t('incubator.newInvoice.subtitle')}
      />
      <InvoiceCreateForm
        defaultVatRate={incubator?.defaultVatRate ?? 19}
        defaultTemplate={incubator?.invoiceTemplate ?? 'CLASSIC'}
        serviceNames={services}
        legalComplete={legalComplete}
        hasBankRib={hasBankRib}
        initialKind={initialKind}
        nextSeq={nextSeq}
        year={year}
      />
    </div>
  );
}
