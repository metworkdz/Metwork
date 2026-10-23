import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoiceCreateForm } from '@/components/features/incubator/invoice-create-form';
import { InvoicingPathsProvider } from '@/components/features/incubator/invoicing-paths';
import { db, type InvoiceKind } from '@/server/db/store';
import { freelancerInvoicingContext } from '@/server/invoices/freelancer-access';
import { FREELANCER_INVOICING_PATHS } from '@/config/freelancer-invoicing';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string }>;
}

const KINDS: InvoiceKind[] = ['FACTURE', 'PROFORMA', 'DEVIS'];

export default async function FreelancerNewInvoicePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { kind } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['FREELANCER']);
  const data = await db.read();
  const ctx = freelancerInvoicingContext(data, user.id);
  // The freelancer's skills double as quick line items.
  const skills = data.freelancerProfiles?.find((p) => p.userId === user.id)?.skills ?? [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('incubator.newInvoice.title')} subtitle={t('incubator.newInvoice.subtitle')} />
      <InvoicingPathsProvider paths={FREELANCER_INVOICING_PATHS}>
        <InvoiceCreateForm
          defaultVatRate={ctx.issuer?.defaultVatRate ?? 0}
          defaultTemplate={ctx.issuer?.invoiceTemplate ?? 'CLASSIC'}
          serviceNames={skills}
          legalComplete={ctx.legalComplete}
          hasBankRib={ctx.hasBankRib}
          hasStamp={ctx.hasStamp}
          initialKind={KINDS.find((k) => k === kind) ?? 'FACTURE'}
          nextSeq={ctx.nextSeq}
          year={ctx.year}
        />
      </InvoicingPathsProvider>
    </div>
  );
}
