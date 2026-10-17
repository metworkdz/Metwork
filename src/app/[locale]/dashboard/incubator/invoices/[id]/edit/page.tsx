/**
 * Correct a proforma or devis — the creation form, opened on the document.
 * A facture, a cancelled document or one already converted is not editable:
 * the page says why instead of showing a form the server would refuse.
 */
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';

import { requireRole } from '@/lib/auth-guards';
import { Link } from '@/i18n/routing';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InvoiceCreateForm } from '@/components/features/incubator/invoice-create-form';
import { db, type InvoiceKind } from '@/server/db/store';
import { peekNextSeq } from '@/server/invoices/engine';
import { draftLock } from '@/server/invoices/drafts';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Modifier le document' };

export default async function EditInvoicePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('incubator.invoiceForm');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  const invoice = incubator ? (data.invoices ?? []).find((i) => i.id === id && i.incubatorId === incubator.id) : undefined;
  if (!incubator || !invoice) notFound();

  const lock = draftLock(invoice);
  const year = new Date().getUTCFullYear();
  const counters = { invoiceCounters: incubator.invoiceCounters ?? null };
  const nextSeq = Object.fromEntries(
    (['FACTURE', 'PROFORMA', 'DEVIS'] as InvoiceKind[]).map((k) => [k, peekNextSeq(counters, year, k)]),
  ) as Record<InvoiceKind, number>;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('editTitle', { number: invoice.number })} subtitle={t('editSubtitle')} />
      {lock ? (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-2">
            <p>{lock.message}</p>
            <Link href="/dashboard/incubator/invoices" className="font-medium text-primary underline-offset-2 hover:underline">
              {t('backToList')}
            </Link>
          </div>
        </div>
      ) : (
        <InvoiceCreateForm
          defaultVatRate={incubator.defaultVatRate ?? 19}
          defaultTemplate={incubator.invoiceTemplate ?? 'CLASSIC'}
          serviceNames={(data.services ?? []).filter((s) => s.incubatorId === incubator.id && s.isActive).map((s) => s.name)}
          legalComplete={Boolean(incubator.name && (incubator.commercialRegNumber ?? incubator.registrationNumber) && incubator.nif)}
          hasBankRib={Boolean(incubator.bankRib?.trim())}
          hasStamp={Boolean(incubator.stampUrl?.trim())}
          initialKind={invoice.kind ?? 'FACTURE'}
          nextSeq={nextSeq}
          year={year}
          editing={invoice}
        />
      )}
    </div>
  );
}
