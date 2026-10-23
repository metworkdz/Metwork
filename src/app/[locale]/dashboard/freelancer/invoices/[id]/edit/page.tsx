import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoiceCreateForm } from '@/components/features/incubator/invoice-create-form';
import { InvoicingPathsProvider } from '@/components/features/incubator/invoicing-paths';
import { Link } from '@/i18n/routing';
import { db } from '@/server/db/store';
import { draftLock } from '@/server/invoices/drafts';
import { ownsInvoice } from '@/server/invoices/owner';
import { freelancerInvoicingContext } from '@/server/invoices/freelancer-access';
import { FREELANCER_INVOICING_PATHS } from '@/config/freelancer-invoicing';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function FreelancerEditInvoicePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('incubator.invoiceForm');
  const user = await requireRole(['FREELANCER']);
  const data = await db.read();
  const ctx = freelancerInvoicingContext(data, user.id);
  const invoice = (data.invoices ?? []).find((i) => i.id === id && ownsInvoice(i, ctx.owner));
  if (!invoice) notFound();
  const lock = draftLock(invoice);
  const skills = data.freelancerProfiles?.find((p) => p.userId === user.id)?.skills ?? [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('editTitle', { number: invoice.number })} subtitle={t('editSubtitle')} />
      {lock ? (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-2">
            <p>{lock.message}</p>
            <Link href="/dashboard/freelancer/invoices" className="font-medium text-primary underline-offset-2 hover:underline">{t('backToList')}</Link>
          </div>
        </div>
      ) : (
        <InvoicingPathsProvider paths={FREELANCER_INVOICING_PATHS}>
          <InvoiceCreateForm
            defaultVatRate={ctx.issuer?.defaultVatRate ?? 0}
            defaultTemplate={ctx.issuer?.invoiceTemplate ?? 'CLASSIC'}
            serviceNames={skills}
            legalComplete={ctx.legalComplete}
            hasBankRib={ctx.hasBankRib}
            hasStamp={ctx.hasStamp}
            initialKind={invoice.kind ?? 'FACTURE'}
            nextSeq={ctx.nextSeq}
            year={ctx.year}
            editing={invoice}
          />
        </InvoicingPathsProvider>
      )}
    </div>
  );
}
