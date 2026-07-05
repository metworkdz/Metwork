import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoiceCreateForm } from '@/components/features/incubator/invoice-create-form';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Nouvelle facture' };

export default async function NewInvoicePage({ params }: PageProps) {
  const { locale } = await params;
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
      />
    </div>
  );
}
