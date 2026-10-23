import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Settings } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoicesTabs } from '@/components/features/incubator/invoices-tabs';
import { InvoicingPathsProvider } from '@/components/features/incubator/invoicing-paths';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { db } from '@/server/db/store';
import { freelancerInvoicingContext } from '@/server/invoices/freelancer-access';
import { FREELANCER_INVOICING_PATHS } from '@/config/freelancer-invoicing';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Invoices, proformas and devis — the incubator documents UI, on freelancer routes. */
export default async function FreelancerInvoicesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.invoices');
  const user = await requireRole(['FREELANCER']);
  const ctx = freelancerInvoicingContext(await db.read(), user.id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          // The list carries its own "create" button per document kind.
          <Button asChild variant="outline"><Link href="/dashboard/freelancer/invoices/settings"><Settings className="size-4" />{t('settingsLink')}</Link></Button>
        }
      />
      <InvoicingPathsProvider paths={FREELANCER_INVOICING_PATHS}>
        <InvoicesTabs
          invoices={ctx.invoices}
          receipts={[]}
          showReceipts={false}
          legalComplete={ctx.legalComplete}
          hasStamp={ctx.hasStamp}
          factureYear={ctx.year}
          nextFactureSeq={ctx.nextSeq.FACTURE}
        />
      </InvoicingPathsProvider>
    </div>
  );
}
